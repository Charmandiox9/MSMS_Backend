import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthSession, SessionService } from '../session.service';

const getCookie = (request: Request, name: string): string | undefined =>
  request.headers.cookie
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthSession }>();
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';

    if (isProduction) {
      const id = getCookie(request, 'session');
      const session = id && (await this.sessionService.get(id));
      if (!session) throw new UnauthorizedException('Sesión no válida o expirada');
      request.user = session;
      return true;
    }

    const token = getCookie(request, 'token');
    if (!token) throw new UnauthorizedException('Token no encontrado');
    request.user = await this.jwtService.verifyAsync<AuthSession>(token);
    return true;
  }
}
