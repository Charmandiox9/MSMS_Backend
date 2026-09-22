import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let transaction: {
    user: { create: jest.Mock };
    preloadedUser: { findUnique: jest.Mock; delete: jest.Mock };
  };
  const jwtService = { sign: jest.fn() };

  const googleUser = {
    googleId: 'google-1',
    email: 'test@ucn.cl',
    name: 'Test User',
    avatarUrl: 'https://example.com/avatar.png',
  };

  beforeEach(async () => {
    transaction = {
      user: { create: jest.fn() },
      preloadedUser: { findUnique: jest.fn(), delete: jest.fn() },
    };
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (transactionClient: typeof transaction) => Promise<unknown>) => callback(transaction),
    );
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('includes role codes in the JWT payload', () => {
    service.generateJwtToken({
      id: 'user-id',
      email: 'user@ucn.cl',
      userRoles: [{ role: { code: 'SYSTEM_ADMIN' } }],
    });

    expect(jwtService.sign).toHaveBeenCalledWith({
      sub: 'user-id',
      email: 'user@ucn.cl',
      roles: ['SYSTEM_ADMIN'],
    });
  });

  it('builds the session payload from the assigned role codes', () => {
    expect(
      service.getSessionPayload({
        id: 'user-id',
        email: 'user@ucn.cl',
        userRoles: [{ role: { code: 'SYSTEM_ADMIN' } }],
      }),
    ).toEqual({
      sub: 'user-id',
      email: 'user@ucn.cl',
      roles: ['SYSTEM_ADMIN'],
    });
  });

  it('includes the Google avatar when available', () => {
    expect(
      service.getSessionPayload({
        id: 'user-id',
        email: 'user@ucn.cl',
        avatarUrl: 'https://example.com/avatar.png',
        userRoles: [],
      }),
    ).toEqual({
      sub: 'user-id',
      email: 'user@ucn.cl',
      roles: [],
      avatarUrl: 'https://example.com/avatar.png',
    });
  });

  it('rechaza al usuario existente pero inactivo, sin actualizarlo', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: googleUser.email,
      googleId: null,
      isActive: false,
    });

    await expect(service.validateGoogleUser(googleUser)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('enlaza el googleId de un usuario activo existente que aún no lo tenía', async () => {
    const existing = {
      id: 'user-1',
      email: googleUser.email,
      googleId: null,
      isActive: true,
    };
    prisma.user.findUnique.mockResolvedValue(existing);
    prisma.user.update.mockResolvedValue({
      ...existing,
      googleId: googleUser.googleId,
    });

    const result = await service.validateGoogleUser(googleUser);

    expect(prisma.user.update).toHaveBeenCalled();
    expect(result.googleId).toBe(googleUser.googleId);
  });

  it('crea un usuario nuevo si no existe', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    transaction.preloadedUser.findUnique.mockResolvedValue(null);
    transaction.user.create.mockResolvedValue({
      id: 'user-2',
      ...googleUser,
      isActive: true,
      userRoles: [],
    });

    const result = await service.validateGoogleUser(googleUser);

    expect(transaction.user.create).toHaveBeenCalled();
    expect(result.email).toBe(googleUser.email);
  });

  it('applies and consumes a preloaded email roles on first login', async () => {
    const preloadedUser = {
      id: 'preload-1',
      roles: [{ roleId: 'role-1' }, { roleId: 'role-2' }],
    };
    prisma.user.findUnique.mockResolvedValue(null);
    transaction.preloadedUser.findUnique.mockResolvedValue(preloadedUser);
    transaction.user.create.mockResolvedValue({
      id: 'user-2',
      ...googleUser,
      isActive: true,
      userRoles: [
        { role: { code: 'SYSTEM_ADMIN' } },
        { role: { code: 'ACADEMIC_SECRETARY' } },
      ],
    });

    const result = await service.validateGoogleUser({ ...googleUser, email: '  TEST@UCN.CL ' });

    expect(transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'test@ucn.cl',
          userRoles: { create: [{ roleId: 'role-1' }, { roleId: 'role-2' }] },
        }),
      }),
    );
    expect(transaction.preloadedUser.delete).toHaveBeenCalledWith({ where: { id: 'preload-1' } });
    expect(result.userRoles).toHaveLength(2);
  });

  it('creates authenticated users without assigning an inferred role', async () => {
    const createdUser = {
      id: 'user-id',
      email: 'staff@ucn.cl',
      userRoles: [],
    };
    prisma.user.findUnique.mockResolvedValue(null);
    transaction.preloadedUser.findUnique.mockResolvedValue(null);
    transaction.user.create.mockResolvedValue(createdUser);

    await service.validateGoogleUser({
      email: 'staff@ucn.cl',
      name: 'Staff UCN',
      googleId: 'google-id',
      avatarUrl: 'https://example.com/avatar.png',
    });

    expect(transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ userRoles: expect.anything() }),
      }),
    );
  });
});
