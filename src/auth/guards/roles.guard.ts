import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { getRequestFromContext } from '../../common/utils/execution-context.util';

type RequestWithRoles = Omit<Request, 'user'> & {
  user?: { roles?: string[] };
};

const SYSTEM_ADMIN_ROLE = 'SYSTEM_ADMIN';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = getRequestFromContext(context) as RequestWithRoles;
    const userRoles = request.user?.roles ?? [];

    if (userRoles.includes(SYSTEM_ADMIN_ROLE)) {
      return true;
    }

    if (!userRoles.some((role) => requiredRoles.includes(role))) {
      throw new ForbiddenException(
        'No tienes el rol necesario para acceder a este recurso',
      );
    }

    return true;
  }
}
