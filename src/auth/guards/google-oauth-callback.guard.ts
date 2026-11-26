import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

@Injectable()
export class GoogleOAuthCallbackGuard extends AuthGuard('google') {
  canActivate(context: ExecutionContext) {
    const { query } = context.switchToHttp().getRequest<Request>();
    if (typeof query.code !== 'string' || !query.code || query.error)
      throw new UnauthorizedException('Inicio de sesión de Google no válido');
    return super.canActivate(context);
  }
}
