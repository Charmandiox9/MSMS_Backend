import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'crypto';

export type AuthSession = {
  sub: string;
  email: string;
  roles: string[];
  avatarUrl?: string;
};

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async create(session: AuthSession): Promise<string> {
    const id = randomUUID();
    await this.cache.set(this.key(id), session, SESSION_TTL_MS);
    return id;
  }

  get(id: string): Promise<AuthSession | undefined> {
    return this.cache.get<AuthSession>(this.key(id));
  }

  delete(id: string): Promise<boolean> {
    return this.cache.del(this.key(id));
  }

  private key(id: string): string {
    return `auth:session:${id}`;
  }
}
