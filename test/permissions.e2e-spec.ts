import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestApp, TestApp, UserKey } from './support/test-app';

type Method = 'get' | 'post' | 'patch' | 'delete';

interface Route {
  method: Method;
  path: string;
  body?: object;
  allowed: UserKey[];
}

const UUID = '00000000-0000-0000-0000-000000000001';

// El administrador del sistema accede a todo; se agrega automáticamente.
const routes: Route[] = [
  { method: 'get', path: '/api/users', allowed: [] },
  { method: 'get', path: '/api/users/preloads', allowed: [] },
  {
    method: 'post',
    path: '/api/users/preloads',
    body: { email: 'nuevo@ucn.cl', roleIds: [UUID] },
    allowed: [],
  },
  { method: 'delete', path: `/api/users/preloads/${UUID}`, allowed: [] },
  {
    method: 'post',
    path: `/api/users/${UUID}/roles`,
    body: { roleId: UUID },
    allowed: [],
  },
  { method: 'delete', path: `/api/users/${UUID}/roles/${UUID}`, allowed: [] },
  {
    method: 'patch',
    path: `/api/users/${UUID}/status`,
    body: { isActive: true },
    allowed: [],
  },
  { method: 'delete', path: `/api/users/${UUID}`, allowed: [] },

  { method: 'get', path: '/api/academic/teachers', allowed: ['secretary'] },
  {
    method: 'get',
    path: `/api/academic/teachers/${UUID}`,
    allowed: ['secretary'],
  },
  {
    method: 'post',
    path: '/api/academic/teachers/import-csv',
    body: { csv: 'x' },
    allowed: ['secretary'],
  },
  {
    method: 'post',
    path: '/api/academic/teachers/import-roster',
    body: { csv: 'x' },
    allowed: ['secretary'],
  },
  { method: 'get', path: '/api/academic/courses', allowed: ['secretary'] },
  {
    method: 'post',
    path: '/api/academic/courses/import-csv',
    body: { csv: 'x' },
    allowed: ['secretary'],
  },
  { method: 'get', path: '/api/academic/semesters', allowed: ['secretary'] },
  {
    method: 'post',
    path: '/api/academic/semesters/activate',
    body: { name: '2026-2', startsOn: '2026-08-01', endsOn: '2026-12-15' },
    allowed: ['secretary'],
  },

  { method: 'get', path: '/api/dashboard/system-admin', allowed: [] },
  {
    method: 'get',
    path: '/api/dashboard/academic-secretary',
    allowed: ['secretary'],
  },
  {
    method: 'get',
    path: '/api/dashboard/academic-process-analyst',
    allowed: ['analyst'],
  },
  {
    method: 'get',
    path: '/api/dashboard/teaching-support-coordinator',
    allowed: ['coordinator'],
  },

  {
    method: 'get',
    path: '/api/justifications/inbox',
    allowed: ['coordinator'],
  },
  {
    method: 'get',
    path: '/api/justifications',
    allowed: ['secretary', 'coordinator'],
  },
  {
    method: 'post',
    path: `/api/justifications/inbox/${UUID}/open`,
    allowed: ['coordinator'],
  },
  {
    method: 'patch',
    path: `/api/justifications/${UUID}/decision`,
    body: { status: 'ACCEPTED' },
    allowed: ['coordinator'],
  },
  {
    method: 'get',
    path: `/api/justifications/${UUID}/evidence-url`,
    allowed: ['secretary', 'coordinator'],
  },

  {
    method: 'post',
    path: '/api/storage/presigned-upload',
    body: { fileName: 'a.pdf', contentType: 'application/pdf' },
    allowed: ['secretary', 'analyst', 'coordinator', 'noRole'],
  },
];

const roleUsers: UserKey[] = ['secretary', 'analyst', 'coordinator', 'noRole'];

describe('Permisos por endpoint (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  function send(route: Route, cookie?: string) {
    const call = request(ctx.app.getHttpServer())[route.method](route.path);
    if (cookie) call.set('Cookie', cookie);
    return route.body ? call.send(route.body) : call;
  }

  describe.each(
    routes.map(
      (route) =>
        [`${route.method.toUpperCase()} ${route.path}`, route] as const,
    ),
  )('%s', (_name, route) => {
    it('responde 401 sin sesión', async () => {
      await send(route).expect(401);
    });

    it('responde 401 a un usuario desactivado aunque sea administrador', async () => {
      await send(route, ctx.cookieFor('inactive')).expect(401);
    });

    it.each(roleUsers)('aplica la regla de acceso para %s', async (user) => {
      const response = await send(route, ctx.cookieFor(user));

      if (route.allowed.includes(user)) {
        expect([401, 403]).not.toContain(response.status);
      } else {
        expect(response.status).toBe(403);
        expect(response.body.message).toBe(
          'No tienes el rol necesario para acceder a este recurso',
        );
      }
    });

    it('permite el acceso al administrador del sistema', async () => {
      const response = await send(route, ctx.cookieFor('admin'));

      expect([401, 403]).not.toContain(response.status);
    });
  });

  describe('tokens', () => {
    const route = {
      method: 'get',
      path: '/api/justifications',
      allowed: [],
    } as Route;

    it('rechaza un token firmado con otro secreto', async () => {
      const forged = new JwtService({ secret: 'otro-secreto' }).sign({
        sub: 'user-admin',
      });

      await send(route, `token=${forged}`).expect(401);
    });

    it('rechaza un token expirado', async () => {
      const expired = new JwtService({ secret: process.env.JWT_SECRET }).sign({
        sub: 'user-admin',
        exp: Math.floor(Date.now() / 1000) - 60,
      });

      await send(route, `token=${expired}`).expect(401);
    });

    it('rechaza un token de un usuario inexistente', async () => {
      const ghost = new JwtService({ secret: process.env.JWT_SECRET }).sign({
        sub: 'ghost',
      });

      await send(route, `token=${ghost}`).expect(401);
    });

    it('rechaza un token con algoritmo none', async () => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: 'user-admin' }),
      ).toString('base64url');

      await send(route, `token=${header}.${payload}.`).expect(401);
    });

    it('ignora los roles incluidos en el token y usa los de la base de datos', async () => {
      const escalated = new JwtService({ secret: process.env.JWT_SECRET }).sign(
        {
          sub: 'user-no-role',
          roles: ['SYSTEM_ADMIN'],
        },
      );

      await send(route, `token=${escalated}`).expect(403);
    });
  });

  describe('endpoints públicos', () => {
    it('GET /api responde sin sesión', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api')
        .expect(200)
        .expect('Hello World!');
    });

    it('GET /api/auth/session devuelve la sesión del token', async () => {
      const response = await request(ctx.app.getHttpServer())
        .get('/api/auth/session')
        .set('Cookie', ctx.cookieFor('secretary'))
        .expect(200);

      expect(response.body.sub).toBe('user-secretary');
    });

    it('GET /api/auth/session responde 401 sin token', async () => {
      await request(ctx.app.getHttpServer())
        .get('/api/auth/session')
        .expect(401);
    });

    it('POST /api/auth/logout limpia la cookie', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/auth/logout')
        .expect(204);

      expect(response.headers['set-cookie']?.[0]).toMatch(/^token=;.*HttpOnly/);
    });
  });
});
