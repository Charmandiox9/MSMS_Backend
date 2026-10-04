import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { ActiveUserService, AuthenticatedUser } from '../active-user.service';

export type JwtAuthenticatedUser = AuthenticatedUser;

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
    private readonly activeUsers: ActiveUserService,
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
    const user = await this.activeUsers.findActive(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Usuario inválido o inactivo');
    }
    return user;
  }
}
