import { ConfigService } from '@nestjs/config';
import { AuthCryptoService } from './auth-crypto.service';

const key = Buffer.alloc(32, 3).toString('base64');
const replacement = Buffer.alloc(32, 4).toString('base64');
const production = { NODE_ENV: 'production' };

function cryptoConfig(values: Record<string, string>) {
  return new AuthCryptoService(new ConfigService(values));
}

describe('AuthCryptoService', () => {
  it('requires a valid independent key in production and with a shared cache', () => {
    expect(() => cryptoConfig(production)).toThrow(
      'AUTH_SESSION_ENCRYPTION_KEY',
    );
    expect(() => cryptoConfig({ CACHE_TYPE: 'redis' })).toThrow(
      'AUTH_SESSION_ENCRYPTION_KEY',
    );
    expect(() =>
      cryptoConfig({ ...production, AUTH_SESSION_ENCRYPTION_KEY: 'invalid' }),
    ).toThrow('AUTH_SESSION_ENCRYPTION_KEY');
    expect(() =>
      cryptoConfig({
        ...production,
        AUTH_SESSION_ENCRYPTION_KEY: key,
        PII_ENCRYPTION_KEYS: JSON.stringify({ pii: key }),
      }),
    ).toThrow('debe ser independiente');
  });

  it('binds the ciphertext to its cache record and invalidates it after rotation', () => {
    const first = cryptoConfig({ AUTH_SESSION_ENCRYPTION_KEY: key });
    const second = cryptoConfig({ AUTH_SESSION_ENCRYPTION_KEY: replacement });
    const envelope = first.encrypt('session', 'auth:session:v2:one');
    expect(first.decrypt(envelope, 'auth:session:v2:one')).toBe('session');
    expect(first.decrypt(envelope, 'auth:session:v2:two')).toBeUndefined();
    expect(first.decrypt(envelope, 'auth:user:v2:one')).toBeUndefined();
    expect(second.decrypt(envelope, 'auth:session:v2:one')).toBeUndefined();
    expect(first.decrypt('pii:v1:old', 'auth:session:v2:one')).toBeUndefined();
  });
});
