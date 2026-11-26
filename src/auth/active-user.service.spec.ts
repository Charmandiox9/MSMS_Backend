import { AuthCryptoService } from './auth-crypto.service';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { ActiveUserService } from './active-user.service';

describe('ActiveUserService', () => {
  const crypto = new AuthCryptoService(
    new ConfigService({
      AUTH_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    }),
  );
  const cacheKey = 'auth:user:v2:user-1';
  let cache: { get: jest.Mock; set: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };
  let service: ActiveUserService;

  beforeEach(() => {
    cache = { get: jest.fn(), set: jest.fn() };
    prisma = { user: { findUnique: jest.fn() } };
    service = new ActiveUserService(
      prisma as unknown as PrismaService,
      cache as unknown as Cache,
      crypto,
    );
  });

  it('returns the display name for the authenticated user and caches the result encrypted', async () => {
    cache.get.mockResolvedValue(undefined);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@ucn.cl',
      name: 'María González',
      avatarUrl: null,
      isActive: true,
      userRoles: [{ role: { code: 'ACADEMIC_SECRETARY' } }],
    });

    await expect(service.findActive('user-1')).resolves.toEqual({
      id: 'user-1',
      email: 'user@ucn.cl',
      displayName: 'María González',
      roles: ['ACADEMIC_SECRETARY'],
    });

    expect(cache.set).toHaveBeenCalledWith(
      cacheKey,
      expect.stringMatching(/^auth:v1:/),
      60 * 1000,
    );
    expect(
      JSON.parse(
        crypto.decrypt(cache.set.mock.calls[0][1] as string, cacheKey),
      ),
    ).toMatchObject({ displayName: 'María González' });
  });

  it('refreshes a cached profile that predates the display name field', async () => {
    cache.get.mockResolvedValue(
      crypto.encrypt(
        JSON.stringify({
          id: 'user-1',
          email: 'user@ucn.cl',
          roles: ['ACADEMIC_SECRETARY'],
        }),
        cacheKey,
      ),
    );
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@ucn.cl',
      name: 'María González',
      avatarUrl: null,
      isActive: true,
      userRoles: [{ role: { code: 'ACADEMIC_SECRETARY' } }],
    });

    await expect(service.findActive('user-1')).resolves.toMatchObject({
      displayName: 'María González',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      include: { userRoles: { include: { role: true } } },
    });
  });
});
