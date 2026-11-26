import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';
import type { Cache } from 'cache-manager';
import type { CookieOptions, Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import type { StrategyOptions } from 'passport-google-oauth20';

const ttlMs = 5 * 60 * 1000;
const noncePattern = /^[A-Za-z0-9_-]{43}$/;
type StoreCallback = (error: Error | null, state?: string) => void;
type VerifyCallback = (
  error: Error | null,
  valid: boolean,
  state?: string,
) => void;

@Injectable()
export class GoogleOAuthStateStore implements NonNullable<
  StrategyOptions['store']
> {
  private readonly redis: KeyvRedis<unknown> | undefined;
  private readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;
  private readonly localClaims = new Set<string>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    config: ConfigService,
  ) {
    const store: unknown = cache.stores[0]?.store;
    if (store instanceof KeyvRedis) this.redis = store;
    const production = config.get('NODE_ENV') === 'production';
    if ((production || config.get('CACHE_TYPE') === 'redis') && !this.redis)
      throw new Error('OAuth requiere el almacén Redis compartido');
    const callback = new URL(config.getOrThrow<string>('GOOGLE_CALLBACK_URL'));
    const localHttp =
      callback.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname);
    if (
      callback.protocol !== 'https:' &&
      (production ? !localHttp : callback.protocol !== 'http:')
    )
      throw new Error('GOOGLE_CALLBACK_URL debe usar HTTPS en producción');
    const secure = callback.protocol === 'https:';
    this.cookieName = secure
      ? '__Host-marsys-oauth-state'
      : 'marsys-oauth-state';
    this.cookieOptions = {
      path: secure ? '/' : callback.pathname,
      httpOnly: true,
      sameSite: 'lax',
      secure,
    };
  }

  store(request: Request, metaOrDone: unknown, callback?: StoreCallback): void {
    const done = this.callback(metaOrDone, callback);
    void this.issue(request).then(
      (state) => done(null, state),
      () =>
        done(new ServiceUnavailableException('No se pudo iniciar la sesión')),
    );
  }

  verify(
    request: Request,
    state: unknown,
    metaOrDone: unknown,
    callback?: VerifyCallback,
  ): void {
    const done = this.callback(metaOrDone, callback);
    void this.consume(request, state).then(
      (valid) => done(null, valid),
      () =>
        done(
          new ServiceUnavailableException(
            'No se pudo validar el inicio de sesión',
          ),
          false,
        ),
    );
  }

  private callback<T>(metaOrDone: unknown, callback?: T): T {
    return typeof metaOrDone === 'function' ? (metaOrDone as T) : callback!;
  }

  private key(state: string, nonce: string): string {
    const digest = createHash('sha256')
      .update(state)
      .update('\0')
      .update(nonce)
      .digest('hex');
    return `auth:google-oauth:v1:${digest}`;
  }

  private async issue(request: Request): Promise<string> {
    const response = request.res;
    if (!response) throw new Error('OAuth response missing');
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const key = this.key(state, nonce);
    if (this.redis) await this.redis.client.set(key, '1', { PX: ttlMs });
    else await this.cache.set(key, true, ttlMs);
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(this.cookieName, nonce, {
      ...this.cookieOptions,
      maxAge: ttlMs,
    });
    return state;
  }

  private async consume(request: Request, state: unknown): Promise<boolean> {
    if (typeof state !== 'string' || !noncePattern.test(state)) return false;
    const cookiePrefix = `${this.cookieName}=`;
    const matches = (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(cookiePrefix));
    if (matches.length !== 1) return false;
    const nonce = matches[0].slice(cookiePrefix.length);
    if (!noncePattern.test(nonce)) return false;
    const key = this.key(state, nonce);
    const valid = this.redis
      ? (await this.redis.client.del(key)) === 1
      : await this.consumeLocal(key);
    if (valid) {
      request.res?.setHeader('Cache-Control', 'no-store');
      request.res?.clearCookie(this.cookieName, this.cookieOptions);
    }
    return valid;
  }

  private async consumeLocal(key: string): Promise<boolean> {
    if (this.localClaims.has(key)) return false;
    this.localClaims.add(key);
    try {
      return (
        (await this.cache.get<boolean>(key)) === true &&
        (await this.cache.del(key))
      );
    } finally {
      this.localClaims.delete(key);
    }
  }
}
