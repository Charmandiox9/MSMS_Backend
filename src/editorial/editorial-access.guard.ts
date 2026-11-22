import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getRequestFromContext } from '../common/utils/execution-context.util';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';

export const EDITORIAL_PERMISSION = 'EDITORIAL_CONTENT_MANAGE';

@Injectable()
export class EditorialAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = getRequestFromContext(context);
    const user = request.user as CurrentUserPayload | undefined;
    if (!user?.id) throw new UnauthorizedException();
    const suppliedRole = request.get('x-marsys-active-role');
    const role =
      suppliedRole ?? (user.roles.length === 1 ? user.roles[0] : undefined);
    if (!role || !(await this.canManage(user.id, role))) {
      throw new ForbiddenException(
        'El rol activo no puede gestionar contenido editorial',
      );
    }
    return true;
  }

  async canManage(userId: string, role: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        userRoles: {
          some: {
            role: {
              code: role,
              permissions: {
                some: { permission: { code: EDITORIAL_PERMISSION } },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    return Boolean(user);
  }
}
