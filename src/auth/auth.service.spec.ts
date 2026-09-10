import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
  };

  const googleUser = {
    googleId: 'google-1',
    email: 'test@ucn.cl',
    name: 'Test User',
    avatarUrl: 'https://example.com/avatar.png',
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: {} },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
    prisma.user.update.mockResolvedValue({ ...existing, googleId: googleUser.googleId });

    const result = await service.validateGoogleUser(googleUser);

    expect(prisma.user.update).toHaveBeenCalled();
    expect(result.googleId).toBe(googleUser.googleId);
  });

  it('crea un usuario nuevo si no existe', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'user-2', ...googleUser, isActive: true });

    const result = await service.validateGoogleUser(googleUser);

    expect(prisma.user.create).toHaveBeenCalled();
    expect(result.email).toBe(googleUser.email);
  });
});
