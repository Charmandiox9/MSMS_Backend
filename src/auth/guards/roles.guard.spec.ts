import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

function createHttpContext(user?: { roles: string[] }): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function createGraphqlContext(user?: { roles: string[] }): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    getType: () => 'graphql',
    getArgs: () => [{}, {}, { req: { user } }, {}],
    switchToHttp: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    guard = module.get(RolesGuard);
    reflector = module.get(Reflector);
  });

  function mockMetadata(isPublic: boolean, requiredRoles?: string[]) {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return isPublic;
        if (key === ROLES_KEY) return requiredRoles;
        return undefined;
      });
  }

  it('permite el acceso cuando el endpoint es público', () => {
    mockMetadata(true, ['STAFF']);
    expect(guard.canActivate(createHttpContext())).toBe(true);
  });

  it('permite el acceso cuando el endpoint no declara roles', () => {
    mockMetadata(false);
    expect(guard.canActivate(createHttpContext({ roles: ['STUDENT'] }))).toBe(
      true,
    );
  });

  it('permite el acceso al administrador del sistema', () => {
    mockMetadata(false, ['STAFF']);
    expect(
      guard.canActivate(createHttpContext({ roles: ['SYSTEM_ADMIN'] })),
    ).toBe(true);
  });

  it('permite el acceso cuando el usuario tiene un rol requerido', () => {
    mockMetadata(false, ['STAFF', 'PROFESSOR']);
    expect(guard.canActivate(createHttpContext({ roles: ['PROFESSOR'] }))).toBe(
      true,
    );
  });

  it('deniega el acceso sin un rol requerido', () => {
    mockMetadata(false, ['STAFF']);
    expect(() =>
      guard.canActivate(createHttpContext({ roles: ['STUDENT'] })),
    ).toThrow(ForbiddenException);
  });

  it('resuelve al usuario también en contexto GraphQL', () => {
    mockMetadata(false, ['STAFF']);
    expect(guard.canActivate(createGraphqlContext({ roles: ['STAFF'] }))).toBe(
      true,
    );
  });
});
