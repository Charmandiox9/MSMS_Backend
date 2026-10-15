import { normalizePostgresSslMode } from './postgres-connection-string';

describe('normalizePostgresSslMode', () => {
  it.each(['prefer', 'require', 'verify-ca'])(
    'makes the legacy %s mode explicit',
    (mode) => {
      expect(
        normalizePostgresSslMode(
          `postgresql://user:password@host/db?sslmode=${mode}&connect_timeout=10`,
        ),
      ).toBe(
        'postgresql://user:password@host/db?sslmode=verify-full&connect_timeout=10',
      );
    },
  );

  it('preserves verify-full and connection strings without an SSL mode', () => {
    expect(
      normalizePostgresSslMode(
        'postgresql://user:password@host/db?sslmode=verify-full',
      ),
    ).toBe('postgresql://user:password@host/db?sslmode=verify-full');
    expect(normalizePostgresSslMode('postgresql://user:password@host/db')).toBe(
      'postgresql://user:password@host/db',
    );
  });
});
