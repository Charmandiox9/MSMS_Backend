import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';

const USER_CACHE_TTL_MS = 60 * 1000;

export type AuthenticatedUser = {
  id: string;
  email: string;
  roles: string[];
  avatarUrl?: string;
};

/**
 * Resuelve un usuario activo con sus roles, cacheado por 60 s. La clave
 * `user:<id>` se invalida al activar, desactivar o eliminar la cuenta.
 */
@Injectable()
export class ActiveUserService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async findActive(id: string): Promise<AuthenticatedUser | null> {
    const cacheKey = `user:${id}`;
    const cachedUser = await this.cache.get<AuthenticatedUser>(cacheKey);
    if (cachedUser) {
      return cachedUser;
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
      roles: user.userRoles.map(({ role }) => role.code),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    };

    await this.cache.set(cacheKey, authenticatedUser, USER_CACHE_TTL_MS);
    return authenticatedUser;
  }
}
