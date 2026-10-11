import request from 'supertest';
import { createTestApp, TestApp } from './support/test-app';

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

  const get = (path: string) =>
    request(ctx.app.getHttpServer())
      .get(path)
      .set('Cookie', ctx.cookieFor('secretary'));

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

    it.each([
      ['page=0'],
      ['page=abc'],
      ['pageSize=101'],
      ['isActive=yes'],
      ['orden=nombre'],
    ])('rechaza ?%s con 400', async (query) => {
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
  });
});
