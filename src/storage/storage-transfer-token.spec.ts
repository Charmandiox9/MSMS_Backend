import {
  signStorageTransfer,
  verifyStorageTransfer,
} from './storage-transfer-token';

describe('storage transfer capabilities', () => {
  const secret = 'storage-test-secret-with-at-least-32-characters';
  const claims = {
    action: 'upload' as const,
    key: 'uploads/private.pdf',
    contentType: 'application/pdf',
    expiresAt: Date.now() + 60000,
  };

  it('binds the operation, file and MIME type', () => {
    const token = signStorageTransfer(claims, secret);
    expect(verifyStorageTransfer(token, 'upload', secret)).toEqual(claims);
    expect(() => verifyStorageTransfer(token, 'download', secret)).toThrow(
      'inválida',
    );
    expect(() =>
      verifyStorageTransfer(token, 'upload', 'other-secret'),
    ).toThrow('inválida');
  });
  it('rejects altered payloads and malformed tokens', () => {
    const token = signStorageTransfer(claims, secret);
    const signature = token.split('.')[1];
    const changed = Buffer.from(
      JSON.stringify({ ...claims, key: 'other/file' }),
    ).toString('base64url');
    for (const value of [
      undefined,
      '',
      'invalid',
      `${changed}.${signature}`,
      token + '.extra',
      'x'.repeat(4097),
    ])
      expect(() => verifyStorageTransfer(value, 'upload', secret)).toThrow(
        'inválida',
      );
  });
  it('rejects expired links', () => {
    const token = signStorageTransfer(
      { ...claims, expiresAt: Date.now() - 1 },
      secret,
    );
    expect(() => verifyStorageTransfer(token, 'upload', secret)).toThrow(
      'caducada',
    );
  });
});
