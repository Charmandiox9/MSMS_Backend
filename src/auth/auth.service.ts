import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  async validateGoogleUser(googleUser: any) {
    let user = await this.prisma.user.findUnique({
      where: { email: googleUser.email },
    });

    if (user) {
      if (!user.isActive) {
        throw new UnauthorizedException('Usuario inactivo');
      }

      if (!user.googleId) {
        user = await this.prisma.user.update({
          where: { email: googleUser.email },
          data: { googleId: googleUser.googleId, avatarUrl: googleUser.avatarUrl },
        });
      }
    } else {
      user = await this.prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name,
          googleId: googleUser.googleId,
          avatarUrl: googleUser.avatarUrl,
        },
      });
    }
    return user;
  }

  generateJwtToken(user: any) {
    const payload = { sub: user.id, email: user.email, roles: user.roles };
    return this.jwtService.sign(payload);
  }
}
