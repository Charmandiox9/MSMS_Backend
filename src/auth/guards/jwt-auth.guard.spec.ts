import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard, Reflector],
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

  it('permite el acceso sin autenticar cuando el endpoint es @Public()', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = createContext();

    expect(guard.canActivate(context)).toBe(true);
  });

  it('delega en la autenticación JWT cuando el endpoint no es público', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const superCanActivate = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockResolvedValue(true);
    const context = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(superCanActivate).toHaveBeenCalledWith(context);
  });
});
