import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private authService: AuthService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, name, emails, photos } = profile;
    const email = emails[0].value;

    // Verificar que el correo pertenezca a ucn.cl
    if (
      !email.endsWith('@ucn.cl') &&
      !email.endsWith('@ce.ucn.cl') &&
      !email.endsWith('@alumnos.ucn.cl')
    ) {
      return done(
        new UnauthorizedException(
          'Solo se permiten correos institucionales UCN',
        ),
        false,
      );
    }

    const user = {
      googleId: id,
      email,
      name: name.givenName + ' ' + name.familyName,
      avatarUrl: photos[0]?.value,
    };

    const validatedUser = await this.authService.validateGoogleUser(user);
    done(null, validatedUser);
  }
}
