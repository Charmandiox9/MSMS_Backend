import request from 'supertest';
import { createTestApp, FORMS_SECRET, TestApp } from './support/test-app';

describe('Flujo de justificaciones (e2e)', () => {
  let ctx: TestApp;

  const submission = {
    externalResponseId: 'form-response-1',
    studentEmail: 'estudiante@alumnos.ucn.cl',
    absenceDate: '2026-09-23T00:00:00.000Z',
    subjectName: 'Nombre desde el formulario',
    nrc: '10001',
    reason: 'Control médico',
    evidenceKey: 'uploads/certificado.pdf',
    evidenceContentType: 'application/pdf',
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.prisma.seedAssignment({
      nrc: '10001',
      activeSemester: true,
      course: { name: 'Biología Marina', code: 'BIO101' },
      teacher: { id: 'teacher-1', name: 'Prof. Gómez', email: 'gomez@ucn.cl' },
    });
    ctx.prisma.seedSchedule({
      nrc: '10001',
      day: 'Miércoles',
      block: 'D',
      activeSemester: true,
    });
    ctx.prisma.seedSchedule({
      nrc: '10001',
      day: 'Miércoles',
      block: 'C',
      activeSemester: true,
    });
    ctx.prisma.seedSchedule({
      nrc: '10001',
      day: 'Jueves',
      block: 'A',
      activeSemester: true,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const http = () => request(ctx.app.getHttpServer());
  const asCoordinator = () => ctx.cookieFor('coordinator');

  let inboxId: string;
  let justificationId: string;

  it('recibe la respuesta del formulario con el secreto del webhook', async () => {
    const response = await http()
      .post('/api/justifications/inbox')
      .set('x-marsys-forms-secret', FORMS_SECRET)
      .send(submission)
      .expect(201);

    inboxId = response.body.id;
    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'UNREAD',
        subjectName: 'Biología Marina',
        subjectCode: 'BIO101',
      }),
    );
  });

  it('no duplica la entrada si el formulario reenvía la misma respuesta', async () => {
    await http()
      .post('/api/justifications/inbox')
      .set('x-google-forms-secret', FORMS_SECRET)
      .send({ ...submission, reason: 'Control médico (reenviado)' })
      .expect(201);

    expect(ctx.prisma.tables.inbox.size).toBe(1);
  });

  it('muestra la entrada no leída con los bloques del día de la inasistencia', async () => {
    const response = await http()
      .get('/api/justifications/inbox')
      .set('Cookie', asCoordinator())
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toEqual(
      expect.objectContaining({
        id: inboxId,
        reason: 'Control médico (reenviado)',
        blocks: ['C', 'D'],
      }),
    );
  });

  it('abre la entrada y crea una justificación pendiente con profesores y bloques', async () => {
    const response = await http()
      .post(`/api/justifications/inbox/${inboxId}/open`)
      .set('Cookie', asCoordinator())
      .expect(201);

    justificationId = response.body.id;
    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'PENDING',
        createdById: 'user-coordinator',
        teachers: [{ name: 'Prof. Gómez', email: 'gomez@ucn.cl' }],
        blocks: ['C', 'D'],
      }),
    );
    expect(ctx.prisma.tables.history).toEqual([
      expect.objectContaining({
        justificationId,
        toStatus: 'PENDING',
        changedById: 'user-coordinator',
      }),
    ]);
  });

  it('abrir otra vez la misma entrada no crea una segunda justificación', async () => {
    const response = await http()
      .post(`/api/justifications/inbox/${inboxId}/open`)
      .set('Cookie', asCoordinator())
      .expect(201);

    expect(response.body.id).toBe(justificationId);
    expect(ctx.prisma.tables.justifications.size).toBe(1);
  });

  it('la bandeja queda vacía y la justificación aparece como pendiente para secretaría', async () => {
    await http()
      .get('/api/justifications/inbox')
      .set('Cookie', asCoordinator())
      .expect(200)
      .expect([]);

    const response = await http()
      .get('/api/justifications?status=PENDING')
      .set('Cookie', ctx.cookieFor('secretary'))
      .expect(200);
    expect(response.body.map((j: { id: string }) => j.id)).toEqual([
      justificationId,
    ]);
  });

  it.each([
    [{ status: 'REJECTED' }, 'Indica el motivo del rechazo'],
    [{ status: 'PENDING' }, 'La decisión debe ser ACCEPTED o REJECTED'],
    [
      { status: 'APPROVED' },
      expect.stringContaining('status must be one of the following values'),
    ],
    [
      { status: 'ACCEPTED', reasonCategory: 'VACACIONES' },
      expect.stringContaining('reasonCategory must be one of'),
    ],
    [{ status: 'ACCEPTED', extra: true }, 'property extra should not exist'],
    [
      { status: 'REJECTED', rejectionReason: 'x'.repeat(1001) },
      expect.stringContaining('rejectionReason must be shorter'),
    ],
  ])('rechaza la decisión inválida %j', async (body, message) => {
    const response = await http()
      .patch(`/api/justifications/${justificationId}/decision`)
      .set('Cookie', asCoordinator())
      .send(body)
      .expect(400);

    expect([response.body.message].flat()).toContainEqual(message);
    expect(ctx.notifications.send).not.toHaveBeenCalled();
  });

  it('aprueba la justificación y notifica al estudiante y al profesor', async () => {
    const response = await http()
      .patch(`/api/justifications/${justificationId}/decision`)
      .set('Cookie', asCoordinator())
      .send({ status: 'ACCEPTED', reasonCategory: 'MEDICAL' })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ACCEPTED',
        reasonCategory: 'MEDICAL',
        decidedById: 'user-coordinator',
      }),
    );
    const recipients = ctx.notifications.send.mock.calls
      .map(([message]) => message.to)
      .sort();
    expect(recipients).toEqual(['estudiante@alumnos.ucn.cl', 'gomez@ucn.cl']);
  });

  it('no permite decidir dos veces', async () => {
    const response = await http()
      .patch(`/api/justifications/${justificationId}/decision`)
      .set('Cookie', asCoordinator())
      .send({ status: 'REJECTED', rejectionReason: 'Cambio de opinión' })
      .expect(400);

    expect(response.body.message).toBe('La justificación ya fue resuelta');
  });

  it('filtra por estado e ignora estados desconocidos', async () => {
    const accepted = await http()
      .get('/api/justifications?status=ACCEPTED')
      .set('Cookie', asCoordinator())
      .expect(200);
    const pending = await http()
      .get('/api/justifications?status=PENDING')
      .set('Cookie', asCoordinator())
      .expect(200);
    const unknown = await http()
      .get('/api/justifications?status=DROP TABLE')
      .set('Cookie', asCoordinator())
      .expect(200);

    expect(accepted.body).toHaveLength(1);
    expect(pending.body).toHaveLength(0);
    expect(unknown.body).toHaveLength(1);
  });

  it('responde 404 al abrir una entrada inexistente', async () => {
    const response = await http()
      .post('/api/justifications/inbox/no-existe/open')
      .set('Cookie', asCoordinator())
      .expect(404);

    expect(response.body.message).toBe('Entrada de formulario no encontrada');
  });

  it('rechaza un NRC desconocido sin nombre de asignatura', async () => {
    const response = await http()
      .post('/api/justifications/inbox')
      .set('x-marsys-forms-secret', FORMS_SECRET)
      .send({
        ...submission,
        externalResponseId: 'form-response-2',
        nrc: '99999',
        subjectName: undefined,
      })
      .expect(400);

    expect(response.body.message).toBe(
      'El NRC no corresponde a una asignatura activa',
    );
  });

  describe('decisiones sobre una nueva entrada', () => {
    async function openNewJustification(responseId: string): Promise<string> {
      const inbox = await http()
        .post('/api/justifications/inbox')
        .set('x-marsys-forms-secret', FORMS_SECRET)
        .send({ ...submission, externalResponseId: responseId })
        .expect(201);
      const opened = await http()
        .post(`/api/justifications/inbox/${inbox.body.id}/open`)
        .set('Cookie', asCoordinator())
        .expect(201);
      return opened.body.id as string;
    }

    beforeEach(() => {
      ctx.notifications.send.mockReset();
      ctx.notifications.send.mockResolvedValue(undefined);
    });

    it('dos decisiones simultáneas: una se aplica y la otra recibe 400', async () => {
      const id = await openNewJustification('form-response-concurrent');

      const responses = await Promise.all([
        http()
          .patch(`/api/justifications/${id}/decision`)
          .set('Cookie', asCoordinator())
          .send({ status: 'ACCEPTED' }),
        http()
          .patch(`/api/justifications/${id}/decision`)
          .set('Cookie', asCoordinator())
          .send({ status: 'REJECTED', rejectionReason: 'Fuera de plazo' }),
      ]);

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 400]);
      const rejected = responses.find(({ status }) => status === 400);
      expect(rejected?.body.message).toBe('La justificación ya fue resuelta');
      const decisions = ctx.prisma.tables.history.filter(
        (entry) => entry.justificationId === id && entry.toStatus !== 'PENDING',
      );
      expect(decisions).toHaveLength(1);
    });

    it('responde 200 con la decisión guardada aunque falle el envío de correos', async () => {
      const id = await openNewJustification('form-response-mail-down');
      ctx.notifications.send.mockRejectedValue(
        new Error('No se pudo enviar la notificación (500)'),
      );

      const response = await http()
        .patch(`/api/justifications/${id}/decision`)
        .set('Cookie', asCoordinator())
        .send({ status: 'ACCEPTED' })
        .expect(200);

      expect(response.body.status).toBe('ACCEPTED');
      expect(ctx.prisma.tables.justifications.get(id)?.status).toBe('ACCEPTED');
    });
  });
});
