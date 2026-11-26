import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const envelopePrefix = 'auth:v1:';

@Injectable()
export class AuthCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const encoded = config.get<string>('AUTH_SESSION_ENCRYPTION_KEY');
    const sharedCache =
      config.get('NODE_ENV') === 'production' ||
      config.get('CACHE_TYPE') === 'redis';
    if (!encoded && !sharedCache) {
      this.key = randomBytes(32);
      return;
    }
    const key = Buffer.from(encoded ?? '', 'base64');
    if (key.length !== 32 || key.toString('base64') !== encoded)
      throw new Error(
        'Configura AUTH_SESSION_ENCRYPTION_KEY con 32 bytes en base64',
      );
    let piiKeys: unknown;
    try {
      piiKeys = JSON.parse(config.get<string>('PII_ENCRYPTION_KEYS') ?? '{}');
    } catch {
      throw new Error('PII_ENCRYPTION_KEYS debe ser un objeto JSON de claves');
    }
    if (
      encoded === config.get('PII_BLIND_INDEX_KEY') ||
      encoded === config.get('JWT_SECRET') ||
      (piiKeys &&
        typeof piiKeys === 'object' &&
        Object.values(piiKeys).includes(encoded))
    ) {
      throw new Error(
        'AUTH_SESSION_ENCRYPTION_KEY debe ser independiente de las claves PII y JWT',
      );
    }
    this.key = key;
  }

  encrypt(value: string, context: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return (
      envelopePrefix +
      Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64')
    );
  }

  decrypt(value: string, context: string): string | undefined {
    if (!value.startsWith(envelopePrefix)) return undefined;
    const encoded = value.slice(envelopePrefix.length);
    const data = Buffer.from(encoded, 'base64');
    if (data.length < 28 || data.toString('base64') !== encoded)
      return undefined;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        data.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return undefined;
    }
  }
}
