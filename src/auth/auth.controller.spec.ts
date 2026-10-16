import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ActiveUserService } from './active-user.service';
import { HEADERS_METADATA } from '@nestjs/common/constants';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    generateJwtToken: jest.fn(),
    getSessionPayload: jest.fn(),
  };
  const sessionService = { create: jest.fn(), delete: jest.fn() };
  const config = { get: jest.fn() };

  beforeEach(async () => {
    config.get.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: SessionService, useValue: sessionService },
        { provide: ConfigService, useValue: config },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        { provide: ActiveUserService, useValue: { findActive: jest.fn() } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('prevents caching session roles in the browser or shared proxies', () => {
    expect(
      Reflect.getMetadata(
        HEADERS_METADATA,
        AuthController.prototype.getSession,
      ),
    ).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
  });

  it('clears the HTTP-only cookie on logout', () => {
    const response = {
      clearCookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    controller.logout({ headers: {} }, response);

    expect(response.clearCookie).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      }),
    );
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.send).toHaveBeenCalled();
  });
  it('scopes login and logout cookies to the public application prefix', async () => {
    const configuration: Record<string, string> = {
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://eic-proyectos.ucn.cl/fasol/marsys/',
    };
    config.get.mockImplementation((key: string) => configuration[key]);
    authService.getSessionPayload.mockReturnValue({
      sub: 'test-user',
      roles: ['SYSTEM_ADMIN'],
    });
    sessionService.create.mockResolvedValue('session-id');
    const response = {
      cookie: jest.fn(),
      redirect: jest.fn(),
      clearCookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    await controller.googleAuthRedirect(
      { user: { id: 'test-user' } },
      response,
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'session',
      'session-id',
      expect.objectContaining({ path: '/fasol/marsys', secure: true }),
    );
    expect(response.redirect.mock.calls[0][0]).toMatch(
      /^https:\/\/eic-proyectos\.ucn\.cl\/fasol\/marsys\/auth\/callback\?/,
    );
    await controller.logout(
      { headers: { cookie: 'session=session-id' } },
      response,
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({ path: '/fasol/marsys' }),
    );
  });
});
