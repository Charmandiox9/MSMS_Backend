import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import request from 'supertest';
import { StorageService } from '../src/storage/storage.service';
import { createTestApp, FORMS_SECRET, TestApp } from './support/test-app';

// StorageService real con credenciales ficticias: la firma de URLs es local y
// las verificaciones HeadObject contra R2 se simulan.
function createR2Storage() {
  return new StorageService(
    new ConfigService({
      STORAGE_PROVIDER: 'r2',
      R2_ACCOUNT_ID: 'e2e-account',
      R2_ACCESS_KEY_ID: 'e2e-access-key',
      R2_SECRET_ACCESS_KEY: 'e2e-secret-key',
      R2_BUCKET_NAME: 'e2e-bucket',
      R2_PRESIGNED_URL_EXPIRES_IN: '300',
    }),
  );
}

describe('Carga de archivos (e2e)', () => {
  let ctx: TestApp;
  let headObject: jest.SpyInstance;

  beforeAll(async () => {
    headObject = jest
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue({} as never);
    ctx = await createTestApp({ storage: createR2Storage() });
  });

  afterAll(async () => {
    await ctx.close();
    headObject.mockRestore();
  });

  const http = () => request(ctx.app.getHttpServer());

  describe('POST /api/storage/presigned-upload', () => {
    it('entrega una URL firmada de subida con key aleatoria bajo uploads/', async () => {
      const response = await http()
        .post('/api/storage/presigned-upload')
        .set('Cookie', ctx.cookieFor('coordinator'))
        .send({ fileName: 'Certificado.PDF', contentType: 'application/pdf' })
        .expect(201);

      expect(response.body.key).toMatch(/^uploads\/[0-9a-f-]{36}\.pdf$/);
      expect(response.body.expiresIn).toBe(300);
      const url = new URL(response.body.uploadUrl);
      expect(url.hostname).toBe('e2e-account.r2.cloudflarestorage.com');
      expect(url.pathname).toBe(`/e2e-bucket/${response.body.key}`);
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('host');
    });

    it('no permite elegir la ruta del objeto mediante el nombre de archivo', async () => {
      const response = await http()
        .post('/api/storage/presigned-upload')
        .set('Cookie', ctx.cookieFor('coordinator'))
        .send({
          fileName: '../../otro-bucket/secreto.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      expect(response.body.key).toMatch(/^uploads\/[0-9a-f-]{36}\.pdf$/);
    });

    it('requiere sesión', async () => {
      await http()
        .post('/api/storage/presigned-upload')
        .send({ fileName: 'a.pdf', contentType: 'application/pdf' })
        .expect(401);
    });

    it.each([
      [{ contentType: 'application/pdf' }, 'fileName should not be empty'],
      [
        { fileName: 'a.pdf', contentType: '' },
        'contentType should not be empty',
      ],
      [
        { fileName: `${'a'.repeat(252)}.pdf`, contentType: 'application/pdf' },
        'fileName must be shorter than or equal to 255 characters',
      ],
      [
        { fileName: 'a.pdf', contentType: 'x'.repeat(151) },
        'contentType must be shorter than or equal to 150 characters',
      ],
      [
        { fileName: 'a.pdf', contentType: 'application/pdf', bucket: 'otro' },
        'property bucket should not exist',
      ],
      [
        { fileName: 123, contentType: 'application/pdf' },
        'fileName must be a string',
      ],
    ])('rechaza el cuerpo inválido %j', async (body, message) => {
      const response = await http()
        .post('/api/storage/presigned-upload')
        .set('Cookie', ctx.cookieFor('coordinator'))
        .send(body)
        .expect(400);

      expect(response.body.message).toContain(message);
    });
  });

  describe('POST /api/storage/presigned-upload/forms', () => {
    const body = { fileName: 'justificativo.jpg', contentType: 'image/jpeg' };

    it('entrega una URL firmada al puente de Google Forms con el secreto', async () => {
      const response = await http()
        .post('/api/storage/presigned-upload/forms')
        .set('x-marsys-forms-secret', FORMS_SECRET)
        .send(body)
        .expect(201);

      expect(response.body.key).toMatch(/^uploads\/[0-9a-f-]{36}\.jpg$/);
    });

    it('acepta el header legado', async () => {
      await http()
        .post('/api/storage/presigned-upload/forms')
        .set('x-google-forms-secret', FORMS_SECRET)
        .send(body)
        .expect(201);
    });

    it.each([
      ['sin secreto', {}],
      ['con secreto incorrecto', { 'x-marsys-forms-secret': 'incorrecto' }],
      ['con una sesión válida pero sin secreto', { Cookie: 'placeholder' }],
    ])(
      'rechaza la solicitud %s',
      async (_case, headers: Record<string, string>) => {
        const call = http().post('/api/storage/presigned-upload/forms');
        Object.entries(headers).forEach(([name, value]) =>
          call.set(name, name === 'Cookie' ? ctx.cookieFor('admin') : value),
        );

        await call.send(body).expect(401);
      },
    );
  });

  describe('POST /api/justifications/inbox (registro de evidencias)', () => {
    const submission = {
      externalResponseId: 'upload-response-1',
      studentEmail: 'estudiante@alumnos.ucn.cl',
      absenceDate: '2026-09-23',
      subjectName: 'Química',
      nrc: '20002',
      evidenceKey: 'uploads/evidencia.pdf',
      evidenceContentType: 'application/pdf',
    };

    it('rechaza envíos sin secreto aunque el cuerpo sea válido', async () => {
      await http()
        .post('/api/justifications/inbox')
        .send(submission)
        .expect(401);
    });

    it.each([
      [{ studentEmail: 'no-es-correo' }, 'studentEmail must be an email'],
      [{ evidenceKey: '' }, 'evidenceKey should not be empty'],
      [
        { evidenceContentType: undefined },
        'evidenceContentType should not be empty',
      ],
      [
        { nrc: '1'.repeat(51) },
        'nrc must be shorter than or equal to 50 characters',
      ],
      [
        { reason: 'x'.repeat(2001) },
        'reason must be shorter than or equal to 2000 characters',
      ],
      [{ status: 'ACCEPTED' }, 'property status should not exist'],
    ])('rechaza el envío inválido %j', async (override, message) => {
      const response = await http()
        .post('/api/justifications/inbox')
        .set('x-marsys-forms-secret', FORMS_SECRET)
        .send({ ...submission, ...override })
        .expect(400);

      expect(response.body.message).toContain(message);
    });

    it('rechaza una fecha de inasistencia inválida', async () => {
      const response = await http()
        .post('/api/justifications/inbox')
        .set('x-marsys-forms-secret', FORMS_SECRET)
        .send({ ...submission, absenceDate: 'mañana' })
        .expect(400);

      expect(response.body.message).toBe(
        'La fecha de inasistencia no es válida',
      );
    });
  });

  describe('GET /api/justifications/:id/evidence-url', () => {
    let justificationId: string;

    beforeAll(async () => {
      const inbox = await http()
        .post('/api/justifications/inbox')
        .set('x-marsys-forms-secret', FORMS_SECRET)
        .send({
          externalResponseId: 'evidence-response-1',
          studentEmail: 'estudiante@alumnos.ucn.cl',
          absenceDate: '2026-09-23',
          subjectName: 'Química',
          nrc: '20002',
          evidenceKey: 'uploads/evidencia.pdf',
          evidenceContentType: 'application/pdf',
        })
        .expect(201);
      const opened = await http()
        .post(`/api/justifications/inbox/${inbox.body.id}/open`)
        .set('Cookie', ctx.cookieFor('coordinator'))
        .expect(201);
      justificationId = opened.body.id;
    });

    it.each(['coordinator', 'secretary'] as const)(
      'entrega una URL de descarga firmada a %s',
      async (user) => {
        const response = await http()
          .get(`/api/justifications/${justificationId}/evidence-url`)
          .set('Cookie', ctx.cookieFor(user))
          .expect(200);

        const url = new URL(response.body.downloadUrl);
        expect(url.pathname).toBe('/e2e-bucket/uploads/evidencia.pdf');
        expect(url.searchParams.get('X-Amz-Signature')).toMatch(
          /^[0-9a-f]{64}$/,
        );
        expect(response.body.expiresIn).toBe(300);
      },
    );

    it('responde 404 para una justificación inexistente', async () => {
      await http()
        .get('/api/justifications/no-existe/evidence-url')
        .set('Cookie', ctx.cookieFor('coordinator'))
        .expect(404);
    });
  });
});

describe('Carga de archivos sin almacenamiento configurado (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp({
      storage: new StorageService(
        new ConfigService({ STORAGE_PROVIDER: 'none' }),
      ),
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('responde 503 en lugar de un error interno', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post('/api/storage/presigned-upload')
      .set('Cookie', ctx.cookieFor('coordinator'))
      .send({ fileName: 'a.pdf', contentType: 'application/pdf' })
      .expect(503);

    expect(response.body.message).toBe(
      'El almacenamiento R2 no está habilitado en este entorno',
    );
  });
});
