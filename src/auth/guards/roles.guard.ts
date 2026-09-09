import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, User } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { getRequestFromContext } from '../../common/utils/execution-context.util';

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

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const user: User | undefined = getRequestFromContext(context).user;

    if (user?.roles.includes(Role.SYSTEM_ADMIN)) {
      return true;
    }

    const hasRequiredRole = user?.roles.some((role) =>
      requiredRoles.includes(role),
    );

    if (!hasRequiredRole) {
      throw new ForbiddenException(
        'No tienes el rol necesario para acceder a este recurso',
      );
    }

    return true;
  }
}
