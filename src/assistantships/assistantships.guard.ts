import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getRequestFromContext } from '../common/utils/execution-context.util';

@Injectable()
export class AssistantshipsGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = getRequestFromContext(context).user;
    if (!user?.id) throw new UnauthorizedException();
    const isRead = [
      'assistantships',
      'assistantshipOptions',
      'assistantshipAssignments',
    ].includes(context.getHandler().name);
    const authorized = await this.prisma.user.findFirst({
      where: {
        id: user.id,
        isActive: true,
        userRoles: {
          some: {
            role: {
              permissions: {
                some: {
                  permission: {
                    code: {
                      in: isRead
                        ? [
                            'TEACHING_ASSISTANTS_MANAGE',
                            'ACADEMIC_RECORDS_VIEW',
                          ]
                        : ['TEACHING_ASSISTANTS_MANAGE'],
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    if (!authorized)
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: 'No tienes permiso para gestionar ayudantías',
      });
    return true;
  }
}
