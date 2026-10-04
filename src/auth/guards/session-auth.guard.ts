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
import { ActiveUserService } from '../active-user.service';
import { getRequestFromContext } from '../../common/utils/execution-context.util';

// `id` replica `sub` para que el usuario del request tenga la misma forma que
// entrega JwtStrategy ({ id, ... }) en cualquier entorno.
export type SessionUser = AuthSession & { id: string };

type RequestWithUser = Omit<Request, 'user'> & { user?: SessionUser };
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
    private readonly activeUsers: ActiveUserService,
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
      request.user = await this.toActiveUser(session);
      return true;
    }

    const token = getCookie(request, 'token');
    if (!token) {
      throw new UnauthorizedException('Token no encontrado');
    }
    const payload = await this.jwtService.verifyAsync<AuthSession>(token);
    request.user = await this.toActiveUser(payload);
    return true;
  }

  // La sesión dura 24 h; se revalida que la cuenta siga activa para que una
  // desactivación tenga efecto sin esperar a que expire.
  private async toActiveUser(session: AuthSession): Promise<SessionUser> {
    if (!(await this.activeUsers.findActive(session.sub))) {
      throw new UnauthorizedException('Usuario inválido o inactivo');
    }
    return { ...session, id: session.sub };
  }
}
