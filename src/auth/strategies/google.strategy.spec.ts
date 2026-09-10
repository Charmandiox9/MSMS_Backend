import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GoogleStrategy } from './google.strategy';
import { AuthService } from '../auth.service';
import { WhitelistService } from '../whitelist/whitelist.service';

describe('GoogleStrategy', () => {
  let strategy: GoogleStrategy;
  let authService: { validateGoogleUser: jest.Mock };
  let whitelistService: { isEmailAllowed: jest.Mock };
  let done: jest.Mock;

  function makeProfile(overrides: Partial<{ verified: boolean; email: string }> = {}) {
    return {
      id: 'google-1',
      name: { givenName: 'Test', familyName: 'User' },
      emails: [{ value: overrides.email ?? 'test@ucn.cl', verified: overrides.verified ?? true }],
      photos: [{ value: 'https://example.com/avatar.png' }],
    };
  }

  beforeEach(async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_CALLBACK_URL = 'http://localhost/callback';

    authService = { validateGoogleUser: jest.fn() };
    whitelistService = { isEmailAllowed: jest.fn() };
    done = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleStrategy,
        { provide: AuthService, useValue: authService },
        { provide: WhitelistService, useValue: whitelistService },
      ],
    }).compile();

    strategy = module.get(GoogleStrategy);
  });

  it('rechaza con UnauthorizedException si el correo de Google no está verificado', async () => {
    whitelistService.isEmailAllowed.mockReturnValue(true);

    await strategy.validate('at', 'rt', makeProfile({ verified: false }), done);

    expect(done).toHaveBeenCalledWith(expect.any(UnauthorizedException), false);
    expect(authService.validateGoogleUser).not.toHaveBeenCalled();
  });

  it('rechaza con ForbiddenException si el correo verificado no está en la whitelist', async () => {
    whitelistService.isEmailAllowed.mockReturnValue(false);

    await strategy.validate('at', 'rt', makeProfile(), done);

    expect(done).toHaveBeenCalledWith(expect.any(ForbiddenException), false);
    expect(authService.validateGoogleUser).not.toHaveBeenCalled();
  });

  it('valida y devuelve el usuario cuando el correo está verificado y autorizado', async () => {
    whitelistService.isEmailAllowed.mockReturnValue(true);
    const validatedUser = { id: 'user-1', email: 'test@ucn.cl' };
    authService.validateGoogleUser.mockResolvedValue(validatedUser);

    await strategy.validate('at', 'rt', makeProfile(), done);

    expect(done).toHaveBeenCalledWith(null, validatedUser);
  });

  it('propaga el error via done() si validateGoogleUser rechaza (ej. usuario inactivo)', async () => {
    whitelistService.isEmailAllowed.mockReturnValue(true);
    const error = new UnauthorizedException('Usuario inactivo');
    authService.validateGoogleUser.mockRejectedValue(error);

    await strategy.validate('at', 'rt', makeProfile(), done);

    expect(done).toHaveBeenCalledWith(error, false);
  });
});
