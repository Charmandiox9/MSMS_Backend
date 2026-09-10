import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

function createHttpContext(user?: { roles: Role[] }): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function createGraphqlContext(user?: { roles: Role[] }): ExecutionContext {
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

  function mockMetadata(isPublic: boolean, requiredRoles?: Role[]) {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return isPublic;
        if (key === ROLES_KEY) return requiredRoles;
        return undefined;
      });
  }

  it('permite el acceso cuando el endpoint es @Public(), sin revisar roles', () => {
    mockMetadata(true, [Role.STAFF]);

    expect(guard.canActivate(createHttpContext(undefined))).toBe(true);
  });

  it('permite el acceso cuando el endpoint no declara @Roles()', () => {
    mockMetadata(false, undefined);

    expect(
      guard.canActivate(createHttpContext({ roles: [Role.STUDENT] })),
    ).toBe(true);
  });

  it('permite el acceso a SYSTEM_ADMIN aunque no esté en los roles requeridos', () => {
    mockMetadata(false, [Role.STAFF]);

    expect(
      guard.canActivate(createHttpContext({ roles: [Role.SYSTEM_ADMIN] })),
    ).toBe(true);
  });

  it('permite el acceso cuando el usuario tiene uno de los roles requeridos', () => {
    mockMetadata(false, [Role.STAFF, Role.PROFESSOR]);

    expect(
      guard.canActivate(createHttpContext({ roles: [Role.PROFESSOR] })),
    ).toBe(true);
  });

  it('deniega el acceso cuando el usuario no tiene ninguno de los roles requeridos', () => {
    mockMetadata(false, [Role.STAFF]);

    expect(() =>
      guard.canActivate(createHttpContext({ roles: [Role.STUDENT] })),
    ).toThrow(ForbiddenException);
  });

  it('deniega el acceso cuando no hay usuario en la request', () => {
    mockMetadata(false, [Role.STAFF]);

    expect(() => guard.canActivate(createHttpContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('resuelve al usuario también en contexto GraphQL', () => {
    mockMetadata(false, [Role.STAFF]);

    expect(
      guard.canActivate(createGraphqlContext({ roles: [Role.STAFF] })),
    ).toBe(true);
  });
});
