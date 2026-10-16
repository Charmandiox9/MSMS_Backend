import { ConfigService } from '@nestjs/config';
import KeyvRedis, { createClient } from '@keyv/redis';
import Keyv from 'keyv';
import type { CacheManagerOptions } from '@nestjs/cache-manager';

export async function createCacheOptions(
  config: ConfigService,
): Promise<CacheManagerOptions> {
  const useRedis =
    config.get<string>('NODE_ENV') === 'production' ||
    config.get<string>('CACHE_TYPE') === 'redis';
  if (!useRedis) return { ttl: 60_000 };
  const url = config.get<string>('REDIS_URL');
  if (!url) throw new Error('REDIS_URL es obligatoria cuando se usa Redis');

  const client = createClient({
    url,
    socket: { connectTimeout: 5000, reconnectStrategy: () => false },
  });
  const adapter = new KeyvRedis(client, {
    throwOnConnectError: true,
    throwOnErrors: true,
  });
  const store = new Keyv({
    store: adapter,
    useKeyPrefix: false,
    throwOnErrors: true,
  });
  // Sessions must fail closed if Redis fails; never fall back to local memory.
  client.on('error', () => undefined);
  store.on('error', () => undefined);
  try {
    await client.connect();
    await client.ping();
  } catch {
    await store.disconnect().catch(() => undefined);
    throw new Error('No se pudo conectar con Redis');
  }
  return { stores: [store], ttl: 60_000 };
}
