import { ConfigService } from '@nestjs/config';
import { PiiCryptoService } from './pii-crypto.service';

/** Test-only keys. Never used by configuration or application startup. */
export function testPiiCrypto() {
  return new PiiCryptoService(
    new ConfigService({
      PII_ACTIVE_KEY_ID: 'test',
      PII_ENCRYPTION_KEYS: JSON.stringify({
        test: Buffer.alloc(32, 1).toString('base64'),
      }),
      PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString('base64'),
    }),
  );
}
