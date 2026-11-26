import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { AuthCryptoService } from './auth-crypto.service';

const USER_CACHE_TTL_MS = 60 * 1000;
export const activeUserCacheKey = (id: string) => `auth:user:v2:${id}`;

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  avatarUrl?: string;
};

/**
 * Resuelve un usuario activo con sus roles, cacheado por 60 s. La clave
 * La clave se invalida cuando cambian el estado o los roles de la cuenta.
 */
@Injectable()
export class ActiveUserService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly crypto: AuthCryptoService,
  ) {}

  async findActive(id: string): Promise<AuthenticatedUser | null> {
    const cacheKey = activeUserCacheKey(id);
    const cachedUser = await this.cache.get<string>(cacheKey);
    const plaintext =
      typeof cachedUser === 'string'
        ? this.crypto.decrypt(cachedUser, cacheKey)
        : undefined;
    if (plaintext !== undefined) {
      const result: unknown = JSON.parse(plaintext);
      if (
        result &&
        typeof result === 'object' &&
        'id' in result &&
        result.id === id &&
        'email' in result &&
        typeof result.email === 'string' &&
        'displayName' in result &&
        typeof result.displayName === 'string' &&
        'roles' in result &&
        Array.isArray(result.roles) &&
        result.roles.every((role: unknown) => typeof role === 'string')
      )
        return result as AuthenticatedUser;
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user || !user.isActive) {
      return null;
    }

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      displayName: user.name,
      roles: user.userRoles.map(({ role }) => role.code),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    };

    await this.cache.set(
      cacheKey,
      this.crypto.encrypt(JSON.stringify(authenticatedUser), cacheKey),
      USER_CACHE_TTL_MS,
    );
    return authenticatedUser;
  }
}
