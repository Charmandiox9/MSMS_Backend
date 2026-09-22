import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
