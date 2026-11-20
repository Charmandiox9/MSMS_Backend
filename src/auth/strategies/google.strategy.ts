import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  type Profile,
  type VerifyCallback,
} from 'passport-google-oauth20';
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';
import { WhitelistService } from '../whitelist/whitelist.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private authService: AuthService,
    private whitelistService: WhitelistService,
  ) {
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
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const emailProfile = profile.emails?.[0];

    if (!emailProfile?.value || !emailProfile.verified) {
      return done(new UnauthorizedException('Correo no verificado'), false);
    }

    const email = emailProfile.value;
    if (!this.whitelistService.isEmailAllowed(email)) {
      return done(new ForbiddenException('Correo no autorizado'), false);
    }

    const name = [profile.name?.givenName, profile.name?.familyName]
      .filter((part): part is string => Boolean(part))
      .join(' ');
    const user = {
      googleId: profile.id,
      email,
      name: name || email.split('@')[0],
      avatarUrl: profile.photos?.[0]?.value,
    };

    try {
      const validatedUser = await this.authService.validateGoogleUser(user);
      done(null, validatedUser);
    } catch (error: unknown) {
      done(
        error instanceof Error
          ? error
          : new Error('No fue posible validar la cuenta de Google'),
        false,
      );
    }
  }
}
