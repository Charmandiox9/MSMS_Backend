import type { Cache } from 'cache-manager';
import { SessionService } from './session.service';

describe('SessionService', () => {
  const session = {
    sub: 'user-1',
    email: 'user@ucn.cl',
    roles: ['SYSTEM_ADMIN'],
  };
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let service: SessionService;

  beforeEach(() => {
    cache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    service = new SessionService(cache as unknown as Cache);
  });

  it('crea una sesión con un identificador aleatorio y TTL de 24 horas', async () => {
    const firstId = await service.create(session);
    const secondId = await service.create(session);

    expect(firstId).toMatch(/^[0-9a-f-]{36}$/);
    expect(secondId).not.toBe(firstId);
    expect(cache.set).toHaveBeenCalledWith(
      `auth:session:${firstId}`,
      session,
      24 * 60 * 60 * 1000,
    );
  });

  it('lee y elimina sesiones usando el prefijo de clave', async () => {
    cache.get.mockResolvedValue(session);
    cache.del.mockResolvedValue(true);

    await expect(service.get('abc')).resolves.toBe(session);
    await expect(service.delete('abc')).resolves.toBe(true);

    expect(cache.get).toHaveBeenCalledWith('auth:session:abc');
    expect(cache.del).toHaveBeenCalledWith('auth:session:abc');
  });
});
