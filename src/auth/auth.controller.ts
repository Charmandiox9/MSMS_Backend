import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { Public } from './decorators/public.decorator';
import { resolveRedirectRoute } from './role-redirect/role-redirect.util';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private sessionService: SessionService,
  ) {}

  private getCookieOptions() {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const secure = frontendUrl.startsWith('https://');

    return {
      httpOnly: true,
      secure,
      sameSite: secure ? ('none' as const) : ('lax' as const),
      path: '/',
      maxAge: 3600000 * 24,
    };
  }

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
    const isProduction = process.env.NODE_ENV === 'production';
    const name = isProduction ? 'session' : 'token';
    const sessionPayload = this.authService.getSessionPayload(user);
    const value = isProduction
      ? await this.sessionService.create(sessionPayload)
      : this.authService.generateJwtToken(user);

    res.cookie(name, value, this.getCookieOptions());

    // El backend calcula la ruta destino según el rol; el frontend solo la
    // lee y redirige. Los roles completos no van en la URL (quedan en el
    // JWT de la cookie, que el frontend no puede leer al ser httpOnly).
    const route = resolveRedirectRoute(sessionPayload.roles);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const params = new URLSearchParams({ route });
    res.redirect(`${frontendUrl}/auth/callback?${params.toString()}`);
  }

  @Public()
  @Get('session')
  @UseGuards(SessionAuthGuard)
  getSession(@Req() req) {
    return req.user;
  }

  @Public()
  @Post('logout')
  async logout(@Req() req, @Res() res) {
    const isProduction = process.env.NODE_ENV === 'production';
    const name = isProduction ? 'session' : 'token';
    const sessionId = req.headers.cookie
      ?.split(';')
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith('session='))
      ?.slice('session='.length);
    if (isProduction && sessionId) await this.sessionService.delete(sessionId);

    res.clearCookie(name, this.getCookieOptions());
    res.status(204).send();
  }
}
