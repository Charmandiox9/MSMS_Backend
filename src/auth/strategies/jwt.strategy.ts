import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

const USER_CACHE_TTL_MS = 60 * 1000;

export type JwtAuthenticatedUser = {
  id: string;
  email: string;
  roles: string[];
  avatarUrl?: string;
};

interface JwtPayload {
  sub: string;
}

function extractJwtFromCookie(req: Request): string | null {
  const parsedCookie: unknown = req.cookies?.token;
  if (typeof parsedCookie === 'string') {
    return parsedCookie;
  }

  const rawCookie = req.headers.cookie
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('token='));

  return rawCookie
    ? decodeURIComponent(rawCookie.slice('token='.length))
    : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    const jwtSecret = config.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET no está definido en el .env');
    }

    super({
      jwtFromRequest: extractJwtFromCookie,
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<JwtAuthenticatedUser> {
    const cacheKey = `user:${payload.sub}`;
    const cachedUser = await this.cache.get<JwtAuthenticatedUser>(cacheKey);
    if (cachedUser) {
      return cachedUser;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario inválido o inactivo');
    }

    const authenticatedUser: JwtAuthenticatedUser = {
      id: user.id,
      email: user.email,
      roles: user.userRoles.map(({ role }) => role.code),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    };

    await this.cache.set(cacheKey, authenticatedUser, USER_CACHE_TTL_MS);
    return authenticatedUser;
  }
}
