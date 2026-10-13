import request from 'supertest';
import { createTestApp, TestApp, UserKey } from './support/test-app';

// La base en memoria no modela docentes: el listado llega vacío y la consulta
// por id no encuentra registros. Aquí se cubre el contrato HTTP (validación de
// query params, formato paginado y códigos de estado); el armado del filtro se
// prueba en academic.service.spec.ts.
describe('Listado de docentes (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const get = (path: string, user: UserKey = 'secretary') =>
    request(ctx.app.getHttpServer())
      .get(path)
      .set('Cookie', ctx.cookieFor(user));

  const post = (path: string, body: unknown, user: UserKey = 'secretary') =>
    request(ctx.app.getHttpServer())
      .post(path)
      .send(body as object)
      .set('Cookie', ctx.cookieFor(user));

  const patch = (path: string, body: unknown, user: UserKey = 'secretary') =>
    request(ctx.app.getHttpServer())
      .patch(path)
      .send(body as object)
      .set('Cookie', ctx.cookieFor(user));

  describe('GET /api/academic/teachers', () => {
    it('responde el formato paginado con valores por defecto', async () => {
      const response = await get('/api/academic/teachers').expect(200);

      expect(response.body).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      });
    });

    it('acepta página, tamaño, búsqueda y estado', async () => {
      const response = await get(
        '/api/academic/teachers?page=2&pageSize=25&search=ana&isActive=false',
      ).expect(200);

      expect(response.body).toEqual(
        expect.objectContaining({ page: 2, pageSize: 25 }),
      );
    });

    it('permite consulta de listado para analistas y coordinadores', async () => {
      await get('/api/academic/teachers', 'analyst').expect(200);
      await get('/api/academic/teachers', 'coordinator').expect(200);
    });

    it.each([
      ['page=0'],
      ['page=abc'],
      ['pageSize=101'],
      ['isActive=yes'],
      ['orden=nombre'],
    ])('rechaza ?%s con 400', async (query: string) => {
      await get(`/api/academic/teachers?${query}`).expect(400);
    });
  });

  describe('GET /api/academic/teachers/:id', () => {
    it('rechaza un id que no es UUID con 400', async () => {
      await get('/api/academic/teachers/no-es-uuid').expect(400);
    });

    it('responde 404 si el docente no existe', async () => {
      const response = await get(
        '/api/academic/teachers/00000000-0000-0000-0000-000000000001',
      ).expect(404);

      expect(response.body.message).toBe('El docente no existe');
    });

    it('permite consulta individual a analistas', async () => {
      await get(
        '/api/academic/teachers/00000000-0000-0000-0000-000000000001',
        'analyst',
      ).expect(404);
    });
  });

  describe('POST /api/academic/teachers', () => {
    it('valida campos obligatorios y formato de correo con 400', async () => {
      await post('/api/academic/teachers', { name: '', email: 'no-correo' }).expect(
        400,
      );
    });

    it('permite crear un docente con datos de acreditación y NRCs', async () => {
      await post('/api/academic/teachers', {
        name: 'Dra. Valentina Muñoz',
        email: 'valentina.munoz@ucn.cl',
        employeeCode: 'DOC-5001',
        academicDegree: 'Doctorado',
        professionalTitle: 'Bióloga Marina',
        institution: 'Universidad Católica del Norte',
        nrcs: ['10001', '10002'],
      }).expect(201);
    });

    it('prohíbe la creación a analistas (403) y usuarios anónimos (401)', async () => {
      await post(
        '/api/academic/teachers',
        { name: 'Ana', email: 'ana@ucn.cl' },
        'analyst',
      ).expect(403);

      await request(ctx.app.getHttpServer())
        .post('/api/academic/teachers')
        .send({ name: 'Ana', email: 'ana@ucn.cl' })
        .expect(401);
    });
  });

  describe('PATCH /api/academic/teachers/:id', () => {
    it('rechaza id no UUID con 400', async () => {
      await patch('/api/academic/teachers/no-uuid', { name: 'Editado' }).expect(400);
    });

    it('prohíbe la edición a analistas con 403', async () => {
      await patch(
        '/api/academic/teachers/00000000-0000-0000-0000-000000000001',
        { name: 'Editado' },
        'analyst',
      ).expect(403);
    });
  });

  describe('PATCH /api/academic/teachers/:id/status', () => {
    it('valida tipo booleano en isActive con 400', async () => {
      await patch(
        '/api/academic/teachers/00000000-0000-0000-0000-000000000001/status',
        { isActive: 'desactivar' },
      ).expect(400);
    });

    it('prohíbe el cambio de estado a analistas con 403', async () => {
      await patch(
        '/api/academic/teachers/00000000-0000-0000-0000-000000000001/status',
        { isActive: false },
        'analyst',
      ).expect(403);
    });
  });

  describe('POST /api/academic/teachers/import-roster', () => {
    it('valida que el contenido CSV no esté vacío con 400', async () => {
      await post('/api/academic/teachers/import-roster', { csv: '' }).expect(400);
    });

    it('prohíbe la importación a analistas con 403', async () => {
      await post(
        '/api/academic/teachers/import-roster',
        { csv: 'nombre;correo;nrc1' },
        'analyst',
      ).expect(403);
    });
  });

  // El cruce de NRC y el armado de la grilla se prueban en academic.service.spec.ts:
  // la base en memoria no modela docentes ni semestres.
  describe('GET /api/academic/teachers/:id/schedule', () => {
    const path =
      '/api/academic/teachers/00000000-0000-0000-0000-000000000001/schedule';

    it('rechaza un id que no es UUID con 400', async () => {
      await get('/api/academic/teachers/no-es-uuid/schedule').expect(400);
    });

    it('responde 404 si el docente no existe', async () => {
      const response = await get(path).expect(404);

      expect(response.body.message).toBe('El docente no existe');
    });

    it('permite la consulta a coordinación docente', async () => {
      await request(ctx.app.getHttpServer())
        .get(path)
        .set('Cookie', ctx.cookieFor('coordinator'))
        .expect(404);
    });

    it('rechaza sin sesión con 401 y sin rol con 403', async () => {
      await request(ctx.app.getHttpServer()).get(path).expect(401);
      await request(ctx.app.getHttpServer())
        .get(path)
        .set('Cookie', ctx.cookieFor('noRole'))
        .expect(403);
    });
  });
});
