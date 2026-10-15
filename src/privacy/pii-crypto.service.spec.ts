import { ConfigService } from '@nestjs/config';
import { PiiCryptoService } from './pii-crypto.service';
import { testPiiCrypto } from './pii-test-config';

describe('Cifrado autenticado de datos personales', () => {
  const crypto = testPiiCrypto();
  it('cifra reversiblemente con nonces aleatorios y oculta el texto original', () => {
    const first = crypto.encrypt('persona@ucn.cl', 'Teacher.email');
    const second = crypto.encrypt('persona@ucn.cl', 'Teacher.email');
    expect(first).not.toBe(second);
    expect(first).not.toContain('persona');
    expect(crypto.decrypt(first, 'Teacher.email')).toBe('persona@ucn.cl');
  });
  it('rechaza modificaciones, contexto incorrecto y datos sin cifrar', () => {
    const value = crypto.encrypt('nombre', 'Teacher.name');
    const data = Buffer.from(value.split(':').at(-1)!, 'base64');
    data[15] ^= 1;
    const tampered =
      value.slice(0, value.lastIndexOf(':') + 1) + data.toString('base64');
    expect(() => crypto.decrypt(tampered, 'Teacher.name')).toThrow(
      'autenticar',
    );
    expect(() => crypto.decrypt(value, 'Student.name')).toThrow('autenticar');
    expect(() => crypto.decrypt('nombre', 'Teacher.name')).toThrow(
      'sin cifrar',
    );
  });
  it('genera índices estables, separados por campo y distintos de SHA-256 sin clave', () => {
    expect(crypto.blindIndex('correo', 'Teacher.email')).toHaveLength(64);
    expect(crypto.blindIndex('correo', 'Teacher.email')).toBe(
      crypto.blindIndex('correo', 'Teacher.email'),
    );
    expect(crypto.blindIndex('correo', 'Teacher.email')).not.toBe(
      crypto.blindIndex('correo', 'Student.email'),
    );
  });
  it('conserva lectura de claves antiguas durante la rotación', () => {
    const rotated = new PiiCryptoService(
      new ConfigService({
        PII_ACTIVE_KEY_ID: 'new',
        PII_ENCRYPTION_KEYS: JSON.stringify({
          test: Buffer.alloc(32, 1).toString('base64'),
          new: Buffer.alloc(32, 3).toString('base64'),
        }),
        PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString('base64'),
      }),
    );
    expect(rotated.decrypt(crypto.encrypt('dato', 'field'), 'field')).toBe(
      'dato',
    );
    expect(rotated.encrypt('dato', 'field')).toContain(':new:');
  });
  it('falla ante claves ausentes, débiles o reutilizadas', () => {
    expect(() => new PiiCryptoService(new ConfigService())).toThrow(
      'Configura',
    );
    expect(
      () =>
        new PiiCryptoService(
          new ConfigService({
            PII_ACTIVE_KEY_ID: 'test',
            PII_ENCRYPTION_KEYS: '{"test":"short"}',
            PII_BLIND_INDEX_KEY: 'short',
          }),
        ),
    ).toThrow('32 bytes');
    expect(
      () =>
        new PiiCryptoService(
          new ConfigService({
            PII_ACTIVE_KEY_ID: 'test',
            PII_ENCRYPTION_KEYS: JSON.stringify({
              test: Buffer.alloc(32, 1).toString('base64'),
            }),
            PII_BLIND_INDEX_KEY: Buffer.alloc(32, 1).toString('base64'),
          }),
        ),
    ).toThrow('independientes');
  });
});
