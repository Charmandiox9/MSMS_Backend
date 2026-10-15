import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const prefix = 'pii:v1:';

@Injectable()
export class PiiCryptoService {
  private readonly keys: ReadonlyMap<string, Buffer>;
  private readonly activeKeyId: string;
  private readonly indexKey: Buffer;

  constructor(config: ConfigService) {
    this.activeKeyId = config.get<string>('PII_ACTIVE_KEY_ID') ?? '';
    const raw = config.get<string>('PII_ENCRYPTION_KEYS');
    const blind = config.get<string>('PII_BLIND_INDEX_KEY');
    if (!raw || !blind || !/^[A-Za-z0-9_-]{1,32}$/.test(this.activeKeyId))
      throw new Error(
        'Configura PII_ENCRYPTION_KEYS, PII_ACTIVE_KEY_ID y PII_BLIND_INDEX_KEY antes de iniciar',
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('PII_ENCRYPTION_KEYS debe ser un objeto JSON de claves');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('El anillo de claves PII no es válido');
    const entries = Object.entries(parsed);
    this.keys = new Map(
      entries.map(([id, key]) => {
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || typeof key !== 'string')
          throw new Error('El anillo de claves PII no es válido');
        return [id, this.key(key)] as const;
      }),
    );
    this.indexKey = this.key(blind);
    if (!this.keys.has(this.activeKeyId))
      throw new Error('La clave PII activa no existe en el anillo');
    if (
      [...this.keys.values()].some((key) => timingSafeEqual(key, this.indexKey))
    )
      throw new Error(
        'Las claves de cifrado e índices PII deben ser independientes',
      );
  }

  private key(encoded: string): Buffer {
    const result = Buffer.from(encoded, 'base64');
    if (result.length !== 32 || result.toString('base64') !== encoded)
      throw new Error(
        'Las claves PII deben contener 32 bytes en base64 canónico',
      );
    return result;
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(prefix);
  }

  encrypt(value: string, context: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.keys.get(this.activeKeyId)!,
      nonce,
    );
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return `${prefix}${this.activeKeyId}:${Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64')}`;
  }

  decrypt(value: string, context: string): string {
    if (!this.isEncrypted(value))
      throw new Error(
        'Se detectó un dato personal sin cifrar; completa la migración PII',
      );
    try {
      const [id, encoded, ...extra] = value.slice(prefix.length).split(':');
      const key = this.keys.get(id);
      const data = Buffer.from(encoded ?? '', 'base64');
      if (
        !key ||
        extra.length ||
        data.length < 28 ||
        data.toString('base64') !== encoded
      )
        throw new Error('Invalid envelope');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        data.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('No fue posible autenticar el dato personal cifrado');
    }
  }

  blindIndex(value: string, context: string): string {
    return createHmac('sha256', this.indexKey)
      .update(context)
      .update('\0')
      .update(value)
      .digest('hex');
  }
}
