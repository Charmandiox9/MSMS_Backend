import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

type GoogleUserProfile = {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string;
};

type UserWithRoles = Prisma.UserGetPayload<{
  include: { userRoles: { include: { role: true } } };
}>;

type UserSessionData = {
  id: string;
  email: string;
  avatarUrl?: string | null;
  userRoles: Array<{ role: { code: string } }>;
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  async validateGoogleUser(googleUser: GoogleUserProfile): Promise<UserWithRoles> {
    const email = googleUser.email.trim().toLowerCase();
    let user = await this.prisma.user.findUnique({
      where: { email },
      include: { userRoles: { include: { role: true } } },
    });

    if (user) {
      if (!user.isActive) {
        throw new UnauthorizedException('Usuario inactivo');
      }

      if (!user.googleId) {
        user = await this.prisma.user.update({
          where: { email },
          data: { googleId: googleUser.googleId, avatarUrl: googleUser.avatarUrl },
          include: { userRoles: { include: { role: true } } },
        });
      }
    } else {
      user = await this.prisma.$transaction(async (transaction) => {
        const preload = await transaction.preloadedUser.findUnique({
          where: { email },
          select: { id: true, roles: { select: { roleId: true } } },
        });
        const createdUser = await transaction.user.create({
          data: {
            email,
            name: googleUser.name,
            googleId: googleUser.googleId,
            ...(googleUser.avatarUrl ? { avatarUrl: googleUser.avatarUrl } : {}),
            ...(preload
              ? { userRoles: { create: preload.roles.map(({ roleId }) => ({ roleId })) } }
              : {}),
          },
          include: { userRoles: { include: { role: true } } },
        });

        if (preload) {
          await transaction.preloadedUser.delete({ where: { id: preload.id } });
        }

        return createdUser;
      });
    }
    return user;
  }

  generateJwtToken(user: UserSessionData) {
    return this.jwtService.sign(this.getSessionPayload(user));
  }

  getSessionPayload(user: UserSessionData) {
    return {
      sub: user.id,
      email: user.email,
      roles: user.userRoles.map(({ role }) => role.code),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    };
  }
}
