import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SessionAuthGuard } from './session-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        Reflector,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SessionAuthGuard, useValue: { canActivate: jest.fn() } },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
    reflector = module.get(Reflector);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createContext(): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('permite el acceso sin autenticar cuando el endpoint es público', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('delega en la autenticación JWT en entornos no productivos', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const config = { get: jest.fn().mockReturnValue('development') };
    const sessionGuard = { canActivate: jest.fn() };
    const nonPublicGuard = new JwtAuthGuard(
      reflector,
      config as unknown as ConfigService,
      sessionGuard as unknown as SessionAuthGuard,
    );
    const superCanActivate = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockResolvedValue(true);
    const context = createContext();

    await expect(nonPublicGuard.canActivate(context)).resolves.toBe(true);
    expect(superCanActivate).toHaveBeenCalledWith(context);
  });
});
