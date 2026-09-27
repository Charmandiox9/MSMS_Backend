import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { Cache } from 'cache-manager';
import { WhitelistService } from '../auth/whitelist/whitelist.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssignRoleDto, PreloadUserDto, UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('AssignRoleDto', () => {
  it('accepts a seeded role identifier with UUID structure', async () => {
    const dto = new AssignRoleDto();
    dto.roleId = '00000000-0000-0000-0000-000000000001';

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects role identifiers that are not UUID-shaped', async () => {
    const dto = new AssignRoleDto();
    dto.roleId = 'system-admin';

    await expect(validate(dto)).resolves.toHaveLength(1);
  });
});

describe('PreloadUserDto', () => {
  it('normalizes the email and accepts one or more seeded role identifiers', async () => {
    const dto = plainToInstance(PreloadUserDto, {
      email: '  NEW.USER@UCN.CL ',
      roleIds: ['00000000-0000-0000-0000-000000000001'],
    });

    expect(dto.email).toBe('new.user@ucn.cl');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('requires a valid email and at least one distinct role', async () => {
    const dto = plainToInstance(PreloadUserDto, {
      email: 'not-an-email',
      roleIds: [],
    });

    await expect(validate(dto)).resolves.toHaveLength(2);
  });
});

describe('UsersController con el usuario autenticado de cada entorno', () => {
  const targetAdmin = { id: 'admin-1', isActive: true, userRoles: [{ role: { code: 'SYSTEM_ADMIN' } }] };
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    userRole: { count: jest.fn() },
    justification: { count: jest.fn() },
    justificationStatusHistory: { count: jest.fn() },
  };
  let controller: UsersController;

  // Desarrollo: JwtStrategy entrega { id, ... }. Producción: SessionAuthGuard entrega la sesión { sub, ... }.
  const jwtUser = { id: 'admin-1', email: 'admin@ucn.cl', roles: ['SYSTEM_ADMIN'] };
  const sessionUser = { sub: 'admin-1', email: 'admin@ucn.cl', roles: ['SYSTEM_ADMIN'] };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(targetAdmin);
    prisma.userRole.count.mockResolvedValue(2);
    prisma.justification.count.mockResolvedValue(0);
    prisma.justificationStatusHistory.count.mockResolvedValue(0);
    const service = new UsersService(
      prisma as unknown as PrismaService,
      { isEmailAllowed: jest.fn() } as unknown as WhitelistService,
      { del: jest.fn() } as unknown as Cache,
    );
    controller = new UsersController(service);
  });

  it.each([
    ['desarrollo (JWT)', jwtUser],
    ['producción (sesión)', sessionUser],
  ])('impide desactivar la propia cuenta en %s', async (_env, actor) => {
    await expect(
      controller.setActive('admin-1', { isActive: false }, actor as unknown as { id: string }),
    ).rejects.toThrow('No puedes desactivar tu propia cuenta');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it.each([
    ['desarrollo (JWT)', jwtUser],
    ['producción (sesión)', sessionUser],
  ])('impide eliminar la propia cuenta en %s', async (_env, actor) => {
    await expect(
      controller.permanentlyDelete('admin-1', actor as unknown as { id: string }),
    ).rejects.toThrow('No puedes eliminar tu propia cuenta');
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });
});
