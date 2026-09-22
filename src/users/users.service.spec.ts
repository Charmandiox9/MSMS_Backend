import { ConflictException, NotFoundException } from '@nestjs/common';
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
