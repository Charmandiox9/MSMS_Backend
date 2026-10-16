import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly storage: StorageService,
  ) {}

  async ready() {
    const key = `health:${randomUUID()}`;
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([
          this.prisma.$queryRaw`SELECT 1`,
          this.checkCache(key),
          this.storage.checkHealth(),
        ]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('timeout')), 5000);
        }),
      ]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException(
        'Servicio temporalmente no disponible',
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async checkCache(key: string) {
    await this.cache.set(key, key, 10_000);
    if ((await this.cache.get(key)) !== key)
      throw new Error('Cache unavailable');
    await this.cache.del(key);
  }
}
