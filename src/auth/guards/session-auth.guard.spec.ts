import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ActiveUserService } from '../active-user.service';
import { SessionService } from '../session.service';
import { SessionAuthGuard } from './session-auth.guard';

type TestRequest = {
  cookies?: Record<string, unknown>;
  headers: { cookie?: string };
  user?: unknown;
};

function createContext(request: TestRequest): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  const session = {
    sub: 'user-1',
    email: 'user@ucn.cl',
    roles: ['ACADEMIC_SECRETARY'],
  };
  const requestUser = { ...session, id: 'user-1' };
  let jwtService: { verifyAsync: jest.Mock };
  let sessionService: { get: jest.Mock };
  let activeUsers: { findActive: jest.Mock };

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    sessionService = { get: jest.fn() };
    activeUsers = {
      findActive: jest
        .fn()
        .mockResolvedValue({
          id: 'user-1',
          email: 'user@ucn.cl',
          roles: ['ACADEMIC_SECRETARY'],
        }),
    };
  });

  function createGuard(nodeEnv: string) {
    return new SessionAuthGuard(
      new ConfigService({ NODE_ENV: nodeEnv }),
      jwtService as unknown as JwtService,
      sessionService as unknown as SessionService,
      activeUsers as unknown as ActiveUserService,
    );
  }

  describe('producción', () => {
    it('adjunta la sesión almacenada al request usando la cookie session', async () => {
      sessionService.get.mockResolvedValue(session);
      const request: TestRequest = {
        cookies: { session: 'session-id' },
        headers: {},
      };

      await expect(
        createGuard('production').canActivate(createContext(request)),
      ).resolves.toBe(true);

      expect(sessionService.get).toHaveBeenCalledWith('session-id');
      expect(activeUsers.findActive).toHaveBeenCalledWith('user-1');
      expect(request.user).toEqual(requestUser);
    });

    it('lee la cookie desde el header cuando cookie-parser no está disponible', async () => {
      sessionService.get.mockResolvedValue(session);
      const request: TestRequest = {
        headers: { cookie: 'other=1; session=raw-id' },
      };

      await createGuard('production').canActivate(createContext(request));

      expect(sessionService.get).toHaveBeenCalledWith('raw-id');
    });

    it('rechaza cuando no hay cookie o la sesión expiró', async () => {
      sessionService.get.mockResolvedValue(undefined);
      const guard = createGuard('production');

      await expect(
        guard.canActivate(createContext({ headers: {} })),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        guard.canActivate(
          createContext({ cookies: { session: 'expired' }, headers: {} }),
        ),
      ).rejects.toThrow('Sesión no válida o expirada');
    });

    it('rechaza una sesión vigente de una cuenta desactivada', async () => {
      sessionService.get.mockResolvedValue(session);
      activeUsers.findActive.mockResolvedValue(null);
      const request: TestRequest = {
        cookies: { session: 'session-id' },
        headers: {},
      };

      await expect(
        createGuard('production').canActivate(createContext(request)),
      ).rejects.toThrow('Usuario inválido o inactivo');
      expect(request.user).toBeUndefined();
    });

    it('no acepta un JWT de desarrollo como sesión', async () => {
      const request: TestRequest = { cookies: { token: 'jwt' }, headers: {} };

      await expect(
        createGuard('production').canActivate(createContext(request)),
      ).rejects.toThrow(UnauthorizedException);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('desarrollo', () => {
    it('verifica el JWT de la cookie token', async () => {
      jwtService.verifyAsync.mockResolvedValue(session);
      const request: TestRequest = { cookies: { token: 'jwt' }, headers: {} };

      await expect(
        createGuard('development').canActivate(createContext(request)),
      ).resolves.toBe(true);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('jwt');
      expect(request.user).toEqual(requestUser);
    });

    it('rechaza un JWT válido de una cuenta desactivada', async () => {
      jwtService.verifyAsync.mockResolvedValue(session);
      activeUsers.findActive.mockResolvedValue(null);

      await expect(
        createGuard('development').canActivate(
          createContext({ cookies: { token: 'jwt' }, headers: {} }),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza cuando no hay token', async () => {
      await expect(
        createGuard('development').canActivate(createContext({ headers: {} })),
      ).rejects.toThrow('Token no encontrado');
    });

    it('propaga el error de un JWT inválido', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

      await expect(
        createGuard('development').canActivate(
          createContext({ cookies: { token: 'bad' }, headers: {} }),
        ),
      ).rejects.toThrow('invalid signature');
    });
  });
});
