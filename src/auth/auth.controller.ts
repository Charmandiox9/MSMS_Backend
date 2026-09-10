import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { resolveRedirectRoute } from './role-redirect/role-redirect.util';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req) {
    // Inicia el flujo de OAuth de Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req, @Res() res) {
    const user = req.user;
    const token = this.authService.generateJwtToken(user);
    // Redirigir al frontend con el token (idealmente set-cookie)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600000 * 24, // 24 hours
    });

    // El backend calcula la ruta destino según el rol; el frontend solo la
    // lee y redirige. Los roles completos no van en la URL (quedan en el
    // JWT de la cookie, que el frontend no puede leer al ser httpOnly).
    const route = resolveRedirectRoute(user.roles);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const params = new URLSearchParams({ route });
    res.redirect(`${frontendUrl}/auth/callback?${params.toString()}`);
  }
}
