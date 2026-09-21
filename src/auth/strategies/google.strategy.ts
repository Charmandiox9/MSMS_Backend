import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
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
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, name, emails, photos } = profile;
    const email = emails[0].value;

    if (!emails[0].verified) {
      return done(new UnauthorizedException('Correo no verificado'), false);
    }

    if (!this.whitelistService.isEmailAllowed(email)) {
      return done(new ForbiddenException('Correo no autorizado'), false);
    }

    const user = {
      googleId: id,
      email,
      name: name.givenName + ' ' + name.familyName,
      avatarUrl: photos[0]?.value,
    };

    try {
      const validatedUser = await this.authService.validateGoogleUser(user);
      done(null, validatedUser);
    } catch (err) {
      done(err, false);
    }
  }
}
