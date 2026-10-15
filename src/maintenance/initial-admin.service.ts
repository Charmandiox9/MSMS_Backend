import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { isEmail } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { WhitelistService } from '../auth/whitelist/whitelist.service';

@Injectable()
export class InitialAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whitelist: WhitelistService,
  ) {}

  async prepare(email: string) {
    const normalized = email.trim().toLowerCase();
    if (!isEmail(normalized) || !this.whitelist.isEmailAllowed(normalized)) {
      throw new BadRequestException(
        'Configura un correo válido autorizado en BOOTSTRAP_ADMIN_EMAIL',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      // Serialize initial provisioning without storing any PII in raw SQL.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(812740021)::text`;
      const role = await tx.role.findUniqueOrThrow({
        where: { code: 'SYSTEM_ADMIN' },
      });
      const activeAdmins = await tx.user.count({
        where: { isActive: true, userRoles: { some: { roleId: role.id } } },
      });
      if (activeAdmins)
        throw new ConflictException(
          'Ya existe un administrador activo; utiliza la administración de usuarios',
        );
      const existing = await tx.preloadedUser.findFirst({
        where: { roles: { some: { roleId: role.id } } },
      });
      if (existing) {
        if (existing.email === normalized)
          return { status: 'already-prepared' };
        throw new ConflictException(
          'Ya existe una precarga de administrador inicial',
        );
      }
      if (await tx.user.findUnique({ where: { email: normalized } })) {
        throw new ConflictException(
          'El correo ya tiene una cuenta; requiere revisión de un administrador',
        );
      }
      await tx.preloadedUser.create({
        data: { email: normalized, roles: { create: { roleId: role.id } } },
      });
      return { status: 'prepared' };
    });
  }
}
