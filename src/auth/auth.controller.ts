import {
  Controller,
  Get,
  Header,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { GoogleOAuthCallbackGuard } from './guards/google-oauth-callback.guard';
import { Public } from './decorators/public.decorator';
import { resolveRedirectRoute } from './role-redirect/role-redirect.util';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { SessionUser } from './guards/session-auth.guard';

type GoogleAuthRequest = Omit<Request, 'user'> & {
  user: Awaited<ReturnType<AuthService['validateGoogleUser']>>;
};

type SessionRequest = Omit<Request, 'user'> & { user: SessionUser };

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private sessionService: SessionService,
    private readonly config: ConfigService,
  ) {}

  private getCookieOptions() {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const secure = frontendUrl.startsWith('https://');

    return {
      httpOnly: true,
      secure,
      sameSite: secure ? ('none' as const) : ('lax' as const),
      path: new URL(frontendUrl).pathname.replace(/\/+$/, '') || '/',
      maxAge: 3600000 * 24,
    };
  }

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    // Inicia el flujo de OAuth de Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleOAuthCallbackGuard)
  async googleAuthRedirect(
    @Req() req: GoogleAuthRequest,
    @Res() res: Response,
  ) {
    const user = req.user;
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    const name = isProduction ? 'session' : 'token';
    const sessionPayload = this.authService.getSessionPayload(user);
    const value = isProduction
      ? await this.sessionService.create(sessionPayload)
      : this.authService.generateJwtToken(user);

    res.cookie(name, value, this.getCookieOptions());

    // El backend calcula la ruta destino según el rol; el frontend solo la
    // lee y redirige. El JWT contiene solo la identidad; /auth/session
    // reconstruye el perfil y los roles desde la cuenta activa.
    const route = resolveRedirectRoute(sessionPayload.roles);
    const frontendUrl = (
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000'
    ).replace(/\/+$/, '');
    const params = new URLSearchParams({ route });
    res.redirect(`${frontendUrl}/auth/callback?${params.toString()}`);
  }

  @Public()
  @Get('session')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  @UseGuards(SessionAuthGuard)
  getSession(@Req() req: SessionRequest) {
    return req.user;
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
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
