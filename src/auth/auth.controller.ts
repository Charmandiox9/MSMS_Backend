import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { SessionAuthGuard } from './guards/session-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private sessionService: SessionService,
  ) {}

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req) {
    // Inicia el flujo de OAuth de Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req, @Res() res) {
    const user = req.user;
    const isProduction = process.env.NODE_ENV === 'production';
    const name = isProduction ? 'session' : 'token';
    const value = isProduction
      ? await this.sessionService.create(this.authService.getSessionPayload(user))
      : this.authService.generateJwtToken(user);

    res.cookie(name, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 3600000 * 24, // 24 hours
    });
    res.redirect('http://localhost:3000/dashboard'); // Redirige al frontend tras el login exitoso
  }

  @Get('session')
  @UseGuards(SessionAuthGuard)
  getSession(@Req() req) {
    return req.user;
  }

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

    res.clearCookie(name, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    res.status(204).send();
  }
}
