import request from 'supertest';
import { createTestApp, TestApp, USERS } from './support/test-app';

// Validación de datos y permisos de las importaciones, semestres y asignaturas.
// La base en memoria no modela docentes ni semestres: aquí se cubren los
// rechazos que ocurren antes de tocar la base (400, 401 y 403).
describe('Validación del módulo académico (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const post = (path: string, user: keyof typeof USERS = 'secretary') =>
    request(ctx.app.getHttpServer())
      .post(path)
      .set('Cookie', ctx.cookieFor(user));

  const teachersHeader =
    'teacherEmail,teacherName,courseName,nrc,semesterName,startsOn,endsOn';

  describe('POST /api/academic/teachers/import-csv', () => {
    const path = '/api/academic/teachers/import-csv';

    it.each([
      [
        'correo inválido',
        `${teachersHeader}\nana-ucn.cl,Ana,Biología,10001,2026-2,2026-08-01,2026-12-15`,
        'Fila 2: Correo inválido: ana-ucn.cl',
      ],
      [
        'filas de distintos semestres',
        `${teachersHeader}\nana@ucn.cl,Ana,Biología,10001,2026-2,2026-08-01,2026-12-15\nluis@ucn.cl,Luis,Química,10002,2027-1,2027-03-01,2027-07-15`,
        'Fila 3: Todas las filas deben ser del semestre 2026-2 (2026-08-01 a 2026-12-15)',
      ],
      [
        'fechas invertidas',
        `${teachersHeader}\nana@ucn.cl,Ana,Biología,10001,2026-2,2026-12-15,2026-08-01`,
        'Fila 2: La fecha de término debe ser posterior al inicio',
      ],
      [
        'columna faltante',
        'teacherEmail,teacherName\nana@ucn.cl,Ana',
        'Falta la columna courseName',
      ],
    ])('rechaza %s con 400 y el motivo', async (_case, csv, message) => {
      const response = await post(path).send({ csv }).expect(400);

      expect(response.body.message).toBe(message);
    });

    it('rechaza un cuerpo sin CSV o con campos extra', async () => {
      await post(path).send({}).expect(400);
      await post(path).send({ csv: '' }).expect(400);
      await post(path).send({ csv: 'a', extra: true }).expect(400);
    });

    it('autoriza al analista y mantiene coordinación sin permiso de importar', async () => {
      const csv = `${teachersHeader}\nana@ucn.cl,Ana,Biología,10001,2026-2,2026-08-01,2026-12-15`;
      await post(path, 'analyst').send({}).expect(400);
      await post(path, 'coordinator').send({ csv }).expect(403);
      await request(ctx.app.getHttpServer())
        .post(path)
        .send({ csv })
        .expect(401);
    });
  });

  describe('POST /api/academic/teachers/import-roster', () => {
    const path = '/api/academic/teachers/import-roster';

    it('indica la fila con el correo inválido', async () => {
      const response = await post(path)
        .send({
          csv: 'nombre,correo,nrc\nAna,ana@ucn.cl,10001\nLuis,luis@,10002',
        })
        .expect(400);

      expect(response.body.message).toBe('Fila 3: Correo inválido: luis@');
    });

    it('valida el cuerpo del analista y rechaza a coordinación', async () => {
      await post(path, 'analyst').send({}).expect(400);
      await post(path, 'coordinator')
        .send({ csv: 'nombre,correo,nrc\nAna,ana@ucn.cl,10001' })
        .expect(403);
    });
  });

  describe('POST /api/academic/courses/import-csv', () => {
    const path = '/api/academic/courses/import-csv';

    it.each([
      [
        'nrc,asignatura,dia,bloque\n10001,Biología,domingo,A',
        'Fila 2: Día inválido: domingo',
      ],
      [
        'nrc,asignatura,dia,bloque\n10001,Biología,lunes,A\n10001,Biología,lunes,Z',
        'Fila 3: Bloque inválido: Z',
      ],
      [
        'nrc,asignatura,dia,bloque\n10001,,lunes,A',
        'Fila 2: Hay una fila incompleta en el CSV de asignaturas',
      ],
    ])('rechaza %j con 400', async (csv, message) => {
      const response = await post(path).send({ csv }).expect(400);

      expect(response.body.message).toBe(message);
    });

    it('rechaza a coordinación con 403', async () => {
      await post(path, 'coordinator')
        .send({ csv: 'nrc,asignatura,dia,bloque\n10001,Biología,lunes,A' })
        .expect(403);
    });
  });

  describe('POST /api/academic/semesters/activate', () => {
    const path = '/api/academic/semesters/activate';
    const valid = {
      name: '2026-2',
      startsOn: '2026-08-01',
      endsOn: '2026-12-15',
    };

    it.each([
      ['nombre en blanco', { ...valid, name: '   ' }],
      ['nombre demasiado largo', { ...valid, name: 'x'.repeat(101) }],
      ['fecha inválida', { ...valid, startsOn: 'ayer' }],
      ['término antes del inicio', { ...valid, endsOn: '2026-07-01' }],
      ['campos extra', { ...valid, isActive: false }],
    ])('rechaza %s con 400', async (_case, body) => {
      await post(path).send(body).expect(400);
    });

    it('rechaza a analistas con 403', async () => {
      await post(path, 'analyst').send(valid).expect(403);
    });
  });

  describe('PATCH /api/academic/courses/:nrc', () => {
    const body = {
      name: 'Biología',
      nrc: '10001',
      schedules: [{ day: 'Lunes', block: 'A' }],
    };
    const patch = (nrc: string, user: keyof typeof USERS = 'secretary') =>
      request(ctx.app.getHttpServer())
        .patch(`/api/academic/courses/${nrc}`)
        .set('Cookie', ctx.cookieFor(user));

    it('rechaza un NRC demasiado largo en la URL', async () => {
      const response = await patch('1'.repeat(51)).send(body).expect(400);

      expect(response.body.message).toBe(
        'El NRC de la asignatura no es válido',
      );
    });

    it('rechaza horarios con día o bloque fuera del catálogo', async () => {
      await patch('10001')
        .send({ ...body, schedules: [{ day: 'Domingo', block: 'A' }] })
        .expect(400);
      await patch('10001')
        .send({ ...body, schedules: [{ day: 'Lunes', block: 'Z' }] })
        .expect(400);
    });

    it('rechaza a coordinación con 403', async () => {
      await patch('10001', 'coordinator').send(body).expect(403);
    });
  });
});
