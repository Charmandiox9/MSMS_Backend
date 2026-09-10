import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const USER_CACHE_TTL_MS = 60 * 1000;

interface JwtPayload {
  sub: string;
}

function extractJwtFromCookie(req: Request): string | null {
  const token: unknown = req.cookies?.token;
  return typeof token === 'string' ? token : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
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

  async validate(payload: JwtPayload): Promise<User> {
    const cacheKey = `user:${payload.sub}`;
    const cachedUser = await this.cache.get<User>(cacheKey);
    const user =
      cachedUser ??
      (await this.prisma.user.findUnique({ where: { id: payload.sub } }));

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario inválido o inactivo');
    }

    if (!cachedUser) {
      await this.cache.set(cacheKey, user, USER_CACHE_TTL_MS);
    }

    return user;
  }
}
