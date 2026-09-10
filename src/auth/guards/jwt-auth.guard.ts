import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionAuthGuard } from './session-auth.guard';
import { getRequestFromContext } from '../../common/utils/execution-context.util';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly sessionAuthGuard: SessionAuthGuard,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (this.configService.get<string>('NODE_ENV') === 'production') {
      return this.sessionAuthGuard.canActivate(context);
    }

    return super.canActivate(context);
  }

  getRequest(context: ExecutionContext) {
    return getRequestFromContext(context);
  }
}
