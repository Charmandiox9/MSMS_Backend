import { ServiceUnavailableException } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

describe('readiness', () => {
  const query = jest.fn();
  const get = jest.fn();
  const set = jest.fn();
  const del = jest.fn();
  const checkHealth = jest.fn();
  const service = new HealthService(
    { $queryRaw: query } as unknown as PrismaService,
    { get, set, del } as unknown as Cache,
    { checkHealth } as unknown as StorageService,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    query.mockResolvedValue([{ '?column?': 1 }]);
    set.mockResolvedValue(true);
    get.mockImplementation(async (key: string) => key);
    del.mockResolvedValue(true);
    checkHealth.mockResolvedValue(undefined);
  });
  it('returns ready only after database, cache roundtrip and bucket check', async () => {
    await expect(new HealthController(service).ready()).resolves.toEqual({
      status: 'ok',
    });
    expect(query).toHaveBeenCalled();
    expect(del).toHaveBeenCalled();
    expect(checkHealth).toHaveBeenCalled();
  });
  it('fails on cache read mismatch', async () => {
    get.mockResolvedValue(undefined);
    await expect(service.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it.each(['database', 'storage'])(
    'does not expose %s connection errors',
    async (dependency) => {
      (dependency === 'database' ? query : checkHealth).mockRejectedValue(
        new Error('private credentials'),
      );
      await expect(service.ready()).rejects.toThrow(
        'Servicio temporalmente no disponible',
      );
    },
  );
  it('has a separate liveness response', () =>
    expect(new HealthController(service).live()).toEqual({ status: 'ok' }));
});
