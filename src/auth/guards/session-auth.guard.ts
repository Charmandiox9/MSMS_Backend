import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthSession, SessionService } from '../session.service';
import { getRequestFromContext } from '../../common/utils/execution-context.util';

type RequestWithUser = Omit<Request, 'user'> & { user?: AuthSession };
type CookieRequest = Omit<Request, 'user'>;

const getCookie = (
  request: CookieRequest,
  name: string,
): string | undefined => {
  const parsedCookie: unknown = request.cookies?.[name];
  if (typeof parsedCookie === 'string') {
    return parsedCookie;
  }

  return request.headers.cookie
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
};

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = getRequestFromContext(context) as RequestWithUser;
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    if (isProduction) {
      const id = getCookie(request, 'session');
      const session = id && (await this.sessionService.get(id));
      if (!session) {
        throw new UnauthorizedException('Sesión no válida o expirada');
      }
      request.user = session;
      return true;
    }

    const token = getCookie(request, 'token');
    if (!token) {
      throw new UnauthorizedException('Token no encontrado');
    }
    request.user = await this.jwtService.verifyAsync<AuthSession>(token);
    return true;
  }
}
