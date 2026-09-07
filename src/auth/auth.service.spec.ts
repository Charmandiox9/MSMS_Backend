import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let service: AuthService;
  const prismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const jwtService = { sign: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaService },
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

  it('creates authenticated users without assigning an inferred role', async () => {
    const createdUser = {
      id: 'user-id',
      email: 'staff@ucn.cl',
      userRoles: [],
    };
    prismaService.user.findUnique = jest.fn().mockResolvedValue(null);
    prismaService.user.create = jest.fn().mockResolvedValue(createdUser);

    await service.validateGoogleUser({
      email: 'staff@ucn.cl',
      name: 'Staff UCN',
      googleId: 'google-id',
      avatarUrl: 'https://example.com/avatar.png',
    });

    expect(prismaService.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ userRoles: expect.anything() }),
      }),
    );
  });
});
