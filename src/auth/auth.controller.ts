import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';

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
      httpOnly: false, // para que el frontend lea la cookie fácilmente para el estado
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3600000 * 24, // 24 hours
    });
    res.redirect('http://localhost:3000/dashboard'); // Redirige al frontend tras el login exitoso
  }
}
