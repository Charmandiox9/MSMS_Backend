import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WhitelistService } from '../auth/whitelist/whitelist.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whitelist: WhitelistService,
  ) {}

  async list(page: number, pageSize: number, search: string, roleCode: string) {
    const where = {
      ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { email: { contains: search, mode: 'insensitive' as const } }] } : {}),
      ...(roleCode ? { userRoles: { some: { role: { code: roleCode } } } } : {}),
    };
    const [total, users, roles] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: [{ name: 'asc' }, { email: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, email: true, avatarUrl: true, isActive: true, userRoles: { select: { role: { select: { id: true, code: true, name: true } } } } } }),
      this.prisma.role.findMany({ orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
    ]);
    return { items: users.map(({ userRoles, ...user }) => ({ ...user, roles: userRoles.map(({ role }) => role) })), roles, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async listPreloads() {
    const preloads = await this.prisma.preloadedUser.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        createdAt: true,
        roles: { select: { role: { select: { id: true, code: true, name: true } } } },
      },
    });

    return {
      items: preloads.map(({ roles, ...preload }) => ({
        ...preload,
        roles: roles.map(({ role }) => role),
      })),
    };
  }

  async preloadUser(email: string, roleIds: string[]) {
    const normalizedEmail = email.trim().toLowerCase();
    const uniqueRoleIds = [...new Set(roleIds)];

    if (uniqueRoleIds.length === 0) {
      throw new BadRequestException('Debe seleccionar al menos un rol');
    }
    if (uniqueRoleIds.length !== roleIds.length) {
      throw new BadRequestException('No se puede asignar el mismo rol más de una vez');
    }
    if (!this.whitelist.isEmailAllowed(normalizedEmail)) {
      throw new BadRequestException('El correo no está autorizado para iniciar sesión en la plataforma');
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const [existingUser, existingPreload, roles] = await Promise.all([
          transaction.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }),
          transaction.preloadedUser.findUnique({ where: { email: normalizedEmail }, select: { id: true } }),
          transaction.role.findMany({ where: { id: { in: uniqueRoleIds } }, select: { id: true } }),
        ]);

        if (existingUser || existingPreload) {
          throw new ConflictException('Ya existe una cuenta o precarga para este correo');
        }
        if (roles.length !== uniqueRoleIds.length) {
          throw new NotFoundException('Uno o más roles no existen');
        }

        return transaction.preloadedUser.create({
          data: {
            email: normalizedEmail,
            roles: {
              create: uniqueRoleIds.map((roleId) => ({ role: { connect: { id: roleId } } })),
            },
          },
          select: {
            id: true,
            email: true,
            createdAt: true,
            roles: { select: { role: { select: { id: true, code: true, name: true } } } },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe una cuenta o precarga para este correo');
      }
      throw error;
    }
  }

  async cancelPreload(id: string) {
    const result = await this.prisma.preloadedUser.deleteMany({ where: { id } });
    if (result.count === 0) throw new NotFoundException('Precarga no encontrada');
    return { success: true };
  }

  async assignRole(userId: string, roleId: string) {
    const [user, role] = await Promise.all([this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }), this.prisma.role.findUnique({ where: { id: roleId }, select: { id: true } })]);
    if (!user || !role) throw new NotFoundException('Usuario o rol no encontrado');
    await this.prisma.userRole.upsert({ where: { userId_roleId: { userId, roleId } }, create: { userId, roleId }, update: {} });
    return { success: true };
  }

  async revokeRole(userId: string, roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId }, select: { code: true } });
    if (!role) throw new NotFoundException('Rol no encontrado');
    if (role.code === 'SYSTEM_ADMIN') {
      const remainingAdmins = await this.prisma.userRole.count({ where: { roleId, user: { isActive: true, userRoles: { some: { role: { code: 'SYSTEM_ADMIN' } } } } } });
      const targetIsActiveAdmin = await this.prisma.userRole.findFirst({ where: { userId, roleId, user: { isActive: true } }, select: { userId: true } });
      if (targetIsActiveAdmin && remainingAdmins <= 1) throw new BadRequestException('No se puede revocar el último rol de administrador activo');
    }
    await this.prisma.userRole.deleteMany({ where: { userId, roleId } });
    return { success: true };
  }
}
