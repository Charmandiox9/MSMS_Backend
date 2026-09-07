import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';

const extractJwtFromCookie = (request: Request): string | null => {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const tokenCookie = cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('token='));

  return tokenCookie ? decodeURIComponent(tokenCookie.slice('token='.length)) : null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractJwtFromCookie]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: { sub: string; email: string; roles: string[] }) {
    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles,
    };
  }
}
