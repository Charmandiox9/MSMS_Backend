import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'crypto';
import { PiiCryptoService } from '../privacy/pii-crypto.service';

export type AuthSession = {
  sub: string;
  email: string;
  roles: string[];
  avatarUrl?: string;
};

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly crypto: PiiCryptoService,
  ) {}

  async create(session: AuthSession): Promise<string> {
    const id = randomUUID();
    await this.cache.set(
      this.key(id),
      this.crypto.encrypt(JSON.stringify(session), this.key(id)),
      SESSION_TTL_MS,
    );
    return id;
  }

  async get(id: string): Promise<AuthSession | undefined> {
    const value = await this.cache.get<string>(this.key(id));
    if (typeof value !== 'string') return undefined;
    const result: unknown = JSON.parse(
      this.crypto.decrypt(value, this.key(id)),
    );
    if (
      !result ||
      typeof result !== 'object' ||
      !('sub' in result) ||
      typeof result.sub !== 'string' ||
      !('email' in result) ||
      typeof result.email !== 'string' ||
      !('roles' in result) ||
      !Array.isArray(result.roles) ||
      !result.roles.every((role: unknown) => typeof role === 'string')
    )
      return undefined;
    return result as AuthSession;
  }

  delete(id: string): Promise<boolean> {
    return this.cache.del(this.key(id));
  }

  private key(id: string): string {
    return `auth:session:pii:v1:${id}`;
  }
}
