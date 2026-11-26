import { ConfigService } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';
import { createCache } from 'cache-manager';
import type { Request } from 'express';
import { GoogleOAuthStateStore } from './google-oauth-state.store';

describe('GoogleOAuthStateStore in production', () => {
  const config = new ConfigService({
    NODE_ENV: 'production',
    GOOGLE_CALLBACK_URL: 'https://example.test/marsys/api/auth/google/callback',
  });

  it('requires shared Redis and atomically consumes a state across instances', async () => {
    const cache = createCache();
    expect(() => new GoogleOAuthStateStore(cache, config)).toThrow('Redis');
    const keys = new Set<string>();
    const client = {
      set: jest.fn(async (key: string) => {
        keys.add(key);
      }),
      del: jest.fn(async (key: string) => Number(keys.delete(key))),
    };
    const adapter = Object.create(KeyvRedis.prototype) as KeyvRedis<unknown>;
    Object.defineProperty(adapter, 'client', { value: client });
    Object.defineProperty(cache.stores[0], 'store', { value: adapter });

    const start = new GoogleOAuthStateStore(cache, config);
    const callback = new GoogleOAuthStateStore(cache, config);
    const response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      setHeader: jest.fn(),
    };
    const initialRequest = { res: response } as unknown as Request;
    const state = await new Promise<string>((resolve, reject) => {
      start.store(initialRequest, (error: Error | null, value: string) =>
        error ? reject(error) : resolve(value),
      );
    });
    const [name, nonce] = response.cookie.mock.calls[0] as [string, string];
    expect(response.cookie).toHaveBeenCalledWith(
      '__Host-marsys-oauth-state',
      expect.any(String),
      {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: 300_000,
      },
    );
    expect(client.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:google-oauth:v1:[a-f0-9]{64}$/),
      '1',
      { PX: 300_000 },
    );
    const request = {
      headers: { cookie: `${name}=${nonce}` },
      res: response,
    } as unknown as Request;
    const verify = (store: GoogleOAuthStateStore) =>
      new Promise<boolean>((resolve, reject) => {
        store.verify(request, state, (error: Error | null, valid: boolean) =>
          error ? reject(error) : resolve(valid),
        );
      });
    expect(
      (await Promise.all([verify(start), verify(callback)])).sort(),
    ).toEqual([false, true]);
    expect(response.clearCookie).toHaveBeenCalledTimes(1);
  });
});
