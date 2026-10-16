import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ActiveUserService } from '../active-user.service';
import { PiiCryptoService } from '../../privacy/pii-crypto.service';
import { testPiiCrypto } from '../../privacy/pii-test-config';

describe('JwtStrategy', () => {
  const crypto = testPiiCrypto();
  let strategy: JwtStrategy;
  let prisma: { user: { findUnique: jest.Mock } };
  let cache: { get: jest.Mock; set: jest.Mock };

  const mockUser = {
    id: 'user-1',
    email: 'test@ucn.cl',
    avatarUrl: null,
    isActive: true,
    userRoles: [{ role: { code: 'ACADEMIC_SECRETARY' } }],
  };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };
    cache = { get: jest.fn(), set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        ActiveUserService,
        { provide: PiiCryptoService, useValue: crypto },
        { provide: ConfigService, useValue: { get: () => 'secret' } },
        { provide: PrismaService, useValue: prisma },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
  });

  it('retorna el usuario desde la base de datos y lo cachea en un cache miss', async () => {
    cache.get.mockResolvedValue(undefined);
    prisma.user.findUnique.mockResolvedValue(mockUser);

    const result = await strategy.validate({ sub: mockUser.id });

    expect(result).toEqual({
      id: mockUser.id,
      email: mockUser.email,
      roles: ['ACADEMIC_SECRETARY'],
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: mockUser.id },
      include: { userRoles: { include: { role: true } } },
    });
    expect(cache.set).toHaveBeenCalledWith(
      `user:pii:v1:${mockUser.id}`,
      expect.stringMatching(/^pii:v1:/),
      60 * 1000,
    );
    expect(
      crypto.decrypt(
        cache.set.mock.calls[0][1] as string,
        `user:pii:v1:${mockUser.id}`,
      ),
    ).toBe(JSON.stringify(result));
  });

  it('retorna el usuario desde el caché sin consultar la base de datos', async () => {
    const cachedUser = {
      id: mockUser.id,
      email: mockUser.email,
      roles: ['ACADEMIC_SECRETARY'],
    };
    cache.get.mockResolvedValue(
      crypto.encrypt(JSON.stringify(cachedUser), `user:pii:v1:${mockUser.id}`),
    );

    const result = await strategy.validate({ sub: mockUser.id });

    expect(result).toEqual(cachedUser);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('lanza UnauthorizedException si el usuario no existe o está inactivo', async () => {
    cache.get.mockResolvedValue(undefined);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(strategy.validate({ sub: 'ghost' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
