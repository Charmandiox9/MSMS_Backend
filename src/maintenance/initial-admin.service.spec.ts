import { InitialAdminService } from './initial-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhitelistService } from '../auth/whitelist/whitelist.service';

describe('initial administrator', () => {
  const create = jest.fn();
  const count = jest.fn();
  const findFirst = jest.fn();
  const findUnique = jest.fn();
  const allowed = jest.fn();
  const tx = {
    $queryRaw: jest.fn(),
    role: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'admin-role' }),
    },
    user: { count, findUnique },
    preloadedUser: { findFirst, create },
  };
  const prisma = {
    $transaction: (callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
  } as unknown as PrismaService;
  const service = new InitialAdminService(prisma, {
    isEmailAllowed: allowed,
  } as unknown as WhitelistService);
  beforeEach(() => {
    jest.clearAllMocks();
    count.mockResolvedValue(0);
    findFirst.mockResolvedValue(null);
    findUnique.mockResolvedValue(null);
    allowed.mockReturnValue(true);
  });
  it('preloads a normalized email using the encrypted Prisma delegate', async () => {
    await expect(service.prepare(' Admin@Example.test ')).resolves.toEqual({
      status: 'prepared',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        email: 'admin@example.test',
        roles: { create: { roleId: 'admin-role' } },
      },
    });
  });
  it('is idempotent for the same initial preload', async () => {
    findFirst.mockResolvedValue({ email: 'admin@example.test' });
    await expect(service.prepare('admin@example.test')).resolves.toEqual({
      status: 'already-prepared',
    });
    expect(create).not.toHaveBeenCalled();
  });
  it('refuses adding administrators after bootstrap', async () => {
    count.mockResolvedValue(1);
    await expect(service.prepare('admin@example.test')).rejects.toThrow(
      'administrador activo',
    );
  });
  it('refuses replacing another initial preload', async () => {
    findFirst.mockResolvedValue({ email: 'other@example.test' });
    await expect(service.prepare('admin@example.test')).rejects.toThrow(
      'precarga',
    );
  });
  it('refuses unauthorized or invalid emails', async () => {
    allowed.mockReturnValue(false);
    await expect(service.prepare('admin@example.test')).rejects.toThrow(
      'correo válido',
    );
    await expect(service.prepare('not-an-email')).rejects.toThrow(
      'correo válido',
    );
  });
});
