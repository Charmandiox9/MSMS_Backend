import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { WhitelistService } from '../auth/whitelist/whitelist.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService preloaded users', () => {
  let service: UsersService;
  let transaction: {
    user: { findUnique: jest.Mock };
    preloadedUser: { findUnique: jest.Mock; create: jest.Mock; deleteMany: jest.Mock };
    role: { findMany: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock; preloadedUser: { findMany: jest.Mock } };
  const whitelist = { isEmailAllowed: jest.fn() };

  beforeEach(() => {
    transaction = {
      user: { findUnique: jest.fn() },
      preloadedUser: { findUnique: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
      role: { findMany: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction)),
      preloadedUser: { findMany: jest.fn() },
    };
    whitelist.isEmailAllowed.mockReturnValue(true);
    service = new UsersService(prisma as unknown as PrismaService, whitelist as unknown as WhitelistService);
  });

  it('stores a normalized email with its selected roles without creating a user account', async () => {
    transaction.user.findUnique.mockResolvedValue(null);
    transaction.preloadedUser.findUnique.mockResolvedValue(null);
    transaction.role.findMany.mockResolvedValue([{ id: 'role-1' }, { id: 'role-2' }]);
    transaction.preloadedUser.create.mockResolvedValue({ id: 'preload-1' });

    await service.preloadUser('  NEW.USER@UCN.CL ', ['role-1', 'role-2']);

    expect(transaction.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'new.user@ucn.cl' },
      select: { id: true },
    });
    expect(transaction.preloadedUser.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        email: 'new.user@ucn.cl',
        roles: {
          create: [
            { role: { connect: { id: 'role-1' } } },
            { role: { connect: { id: 'role-2' } } },
          ],
        },
      },
    }));
  });

  it('rejects an email that already belongs to a user', async () => {
    transaction.user.findUnique.mockResolvedValue({ id: 'user-1' });
    transaction.preloadedUser.findUnique.mockResolvedValue(null);
    transaction.role.findMany.mockResolvedValue([{ id: 'role-1' }]);

    await expect(service.preloadUser('existing@ucn.cl', ['role-1'])).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.preloadedUser.create).not.toHaveBeenCalled();
  });

  it('rejects role IDs that do not resolve to configured roles', async () => {
    transaction.user.findUnique.mockResolvedValue(null);
    transaction.preloadedUser.findUnique.mockResolvedValue(null);
    transaction.role.findMany.mockResolvedValue([]);

    await expect(service.preloadUser('new@ucn.cl', ['unknown-role'])).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.preloadedUser.create).not.toHaveBeenCalled();
  });

  it('rejects emails that the sign-in whitelist would block', async () => {
    whitelist.isEmailAllowed.mockReturnValue(false);

    await expect(service.preloadUser('outside@example.com', ['role-1'])).rejects.toThrow(
      'El correo no está autorizado para iniciar sesión en la plataforma',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('UsersService account administration', () => {
  let service: UsersService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    role: { findUnique: jest.Mock };
    userRole: { count: jest.Mock; findFirst: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
    justification: { count: jest.Mock };
    justificationStatusHistory: { count: jest.Mock };
  };
  const cache = { del: jest.fn() };
  const admin = { id: 'admin-2', isActive: true, userRoles: [{ role: { code: 'SYSTEM_ADMIN' } }] };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
      role: { findUnique: jest.fn() },
      userRole: { count: jest.fn(), findFirst: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
      justification: { count: jest.fn().mockResolvedValue(0) },
      justificationStatusHistory: { count: jest.fn().mockResolvedValue(0) },
    };
    service = new UsersService(
      prisma as unknown as PrismaService,
      { isEmailAllowed: jest.fn() } as unknown as WhitelistService,
      cache as unknown as Cache,
    );
  });

  describe('assignRole', () => {
    it('asigna el rol de forma idempotente', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1' });

      await expect(service.assignRole('user-1', 'role-1')).resolves.toEqual({ success: true });
      expect(prisma.userRole.upsert).toHaveBeenCalledWith({
        where: { userId_roleId: { userId: 'user-1', roleId: 'role-1' } },
        create: { userId: 'user-1', roleId: 'role-1' },
        update: {},
      });
    });

    it('rechaza usuarios o roles inexistentes', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1' });

      await expect(service.assignRole('ghost', 'role-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.userRole.upsert).not.toHaveBeenCalled();
    });
  });

  describe('revokeRole', () => {
    it('impide revocar el último rol de administrador activo', async () => {
      prisma.role.findUnique.mockResolvedValue({ code: 'SYSTEM_ADMIN' });
      prisma.userRole.count.mockResolvedValue(1);
      prisma.userRole.findFirst.mockResolvedValue({ userId: 'admin-1' });

      await expect(service.revokeRole('admin-1', 'admin-role')).rejects.toThrow(
        'No se puede revocar el último rol de administrador activo',
      );
      expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
    });

    it('revoca el rol de administrador si quedan otros activos', async () => {
      prisma.role.findUnique.mockResolvedValue({ code: 'SYSTEM_ADMIN' });
      prisma.userRole.count.mockResolvedValue(2);
      prisma.userRole.findFirst.mockResolvedValue({ userId: 'admin-1' });

      await expect(service.revokeRole('admin-1', 'admin-role')).resolves.toEqual({ success: true });
      expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'admin-1', roleId: 'admin-role' } });
    });

    it('rechaza un rol inexistente', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.revokeRole('user-1', 'missing')).rejects.toThrow('Rol no encontrado');
    });
  });

  describe('setActive', () => {
    it('impide que un usuario se desactive a sí mismo', async () => {
      await expect(service.setActive('admin-1', false, 'admin-1')).rejects.toThrow(
        'No puedes desactivar tu propia cuenta',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('impide desactivar al último administrador activo', async () => {
      prisma.user.findUnique.mockResolvedValue(admin);
      prisma.userRole.count.mockResolvedValue(1);

      await expect(service.setActive('admin-2', false, 'admin-1')).rejects.toThrow(
        'No se puede desactivar el último administrador activo',
      );
    });

    it('desactiva la cuenta e invalida el usuario cacheado', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...admin, userRoles: [] });

      await expect(service.setActive('user-9', false, 'admin-1')).resolves.toEqual({ success: true, isActive: false });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-9' }, data: { isActive: false } });
      expect(cache.del).toHaveBeenCalledWith('user:user-9');
    });

    it('rechaza usuarios inexistentes', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.setActive('ghost', true, 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('permanentlyDelete', () => {
    it('impide que un usuario se elimine a sí mismo', async () => {
      await expect(service.permanentlyDelete('admin-1', 'admin-1')).rejects.toThrow(
        'No puedes eliminar tu propia cuenta',
      );
    });

    it('impide eliminar al último administrador activo', async () => {
      prisma.user.findUnique.mockResolvedValue(admin);
      prisma.userRole.count.mockResolvedValue(0);

      await expect(service.permanentlyDelete('admin-2', 'admin-1')).rejects.toThrow(
        'No se puede eliminar el último administrador activo',
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('conserva cuentas con actividad en justificaciones', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...admin, userRoles: [] });
      prisma.justificationStatusHistory.count.mockResolvedValue(1);

      await expect(service.permanentlyDelete('user-9', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('elimina cuentas sin actividad e invalida el caché', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...admin, userRoles: [] });

      await expect(service.permanentlyDelete('user-9', 'admin-1')).resolves.toEqual({ success: true });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-9' } });
      expect(cache.del).toHaveBeenCalledWith('user:user-9');
    });
  });
});
