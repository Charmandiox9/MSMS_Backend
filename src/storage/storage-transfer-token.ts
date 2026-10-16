import { UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const MAX_STORAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

export type StorageTransfer = {
  action: 'upload' | 'download';
  key: string;
  contentType?: string;
  expiresAt: number;
};

function signature(payload: string, secret: string): Buffer {
  // Domain separation prevents these capabilities from being session tokens.
  return createHmac('sha256', secret)
    .update(`marsys:storage-transfer:v1:${payload}`)
    .digest();
}

export function signStorageTransfer(claims: StorageTransfer, secret: string) {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, nonce: randomUUID() }),
  ).toString('base64url');
  return `${payload}.${signature(payload, secret).toString('base64url')}`;
}

export function verifyStorageTransfer(
  token: string | undefined,
  action: StorageTransfer['action'],
  secret: string,
): StorageTransfer {
  try {
    if (!token || token.length > 4096) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 2) throw new Error();
    const [payload, encodedSignature] = parts;
    const expected = signature(payload, secret);
    const actual = Buffer.from(encodedSignature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error();
    const value: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
    if (
      !value ||
      typeof value !== 'object' ||
      !('action' in value) ||
      value.action !== action ||
      !('key' in value) ||
      typeof value.key !== 'string' ||
      !value.key ||
      !('expiresAt' in value) ||
      typeof value.expiresAt !== 'number' ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= Date.now() ||
      ('contentType' in value && typeof value.contentType !== 'string') ||
      (action === 'upload' && !('contentType' in value))
    )
      throw new Error();
    return {
      action,
      key: value.key,
      expiresAt: value.expiresAt,
      ...('contentType' in value
        ? { contentType: value.contentType as string }
        : {}),
    };
  } catch {
    throw new UnauthorizedException('URL de archivo inválida o caducada');
  }
}
