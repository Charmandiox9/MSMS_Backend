import type { Cache } from 'cache-manager';
import { SessionService } from './session.service';
import { testPiiCrypto } from '../privacy/pii-test-config';

describe('SessionService', () => {
  const crypto = testPiiCrypto();
  const session = {
    sub: 'user-1',
    email: 'user@ucn.cl',
    roles: ['SYSTEM_ADMIN'],
  };
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let service: SessionService;

  beforeEach(() => {
    cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    service = new SessionService(cache as unknown as Cache, crypto);
  });

  it('crea una sesión con un identificador aleatorio y TTL de 24 horas', async () => {
    const firstId = await service.create(session);
    const secondId = await service.create(session);

    expect(firstId).toMatch(/^[0-9a-f-]{36}$/);
    expect(secondId).not.toBe(firstId);
    expect(cache.set).toHaveBeenCalledWith(
      `auth:session:pii:v1:${firstId}`,
      expect.stringMatching(/^pii:v1:/),
      24 * 60 * 60 * 1000,
    );
    expect(
      JSON.parse(
        crypto.decrypt(
          cache.set.mock.calls[0][1] as string,
          `auth:session:pii:v1:${firstId}`,
        ),
      ),
    ).toEqual(session);
  });

  it('lee y elimina sesiones usando el prefijo de clave', async () => {
    cache.get.mockResolvedValue(
      crypto.encrypt(JSON.stringify(session), 'auth:session:pii:v1:abc'),
    );
    cache.del.mockResolvedValue(true);

    await expect(service.get('abc')).resolves.toEqual(session);
    await expect(service.delete('abc')).resolves.toBe(true);

    expect(cache.get).toHaveBeenCalledWith('auth:session:pii:v1:abc');
    expect(cache.del).toHaveBeenCalledWith('auth:session:pii:v1:abc');
  });
});
