import { ConfigService } from '@nestjs/config';
import { createCacheOptions } from './cache-options';

describe('cache configuration', () => {
  it('allows memory in development', async () =>
    expect(
      await createCacheOptions(new ConfigService({ NODE_ENV: 'development' })),
    ).toEqual({ ttl: 60_000 }));
  it.each([{ NODE_ENV: 'production' }, { CACHE_TYPE: 'redis' }])(
    'requires Redis URL without a silent fallback',
    async (config) => {
      await expect(
        createCacheOptions(new ConfigService(config)),
      ).rejects.toThrow('REDIS_URL');
    },
  );
});
