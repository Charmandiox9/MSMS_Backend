import { UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { GoogleStrategy } from '../src/auth/strategies/google.strategy';
import { createTestApp, type TestApp } from './support/test-app';

describe('Google OAuth state (e2e)', () => {
  let ctx: TestApp;
  let exchange: jest.SpyInstance;

  beforeAll(async () => {
    ctx = await createTestApp();
    const strategy = ctx.app.get(GoogleStrategy);
    exchange = jest
      .spyOn(strategy['_oauth2'], 'getOAuthAccessToken')
      .mockImplementation((_code, _params, done) =>
        done(null, 'mock-token', 'mock-refresh'),
      );
    jest.spyOn(strategy, 'userProfile').mockImplementation((_token, done) => {
      done(new UnauthorizedException('Perfil de Google simulado'));
    });
  });
  beforeEach(() => exchange.mockClear());
  afterAll(async () => {
    jest.restoreAllMocks();
    await ctx.close();
  });

  const http = () => request(ctx.app.getHttpServer());
  const callback = '/api/auth/google/callback';

  async function begin() {
    const response = await http().get('/api/auth/google').expect(302);
    const state = new URL(response.headers.location).searchParams.get('state');
    const header = response.headers['set-cookie'][0] as string;
    const cookie = header.split(';')[0];
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(header).toMatch(
      /^marsys-oauth-state=.*Max-Age=300; Path=\/api\/auth\/google\/callback;.*HttpOnly; SameSite=Lax/,
    );
    return { state, cookie };
  }

  it('rejects missing, mismatched and ambiguous state before exchanging the code', async () => {
    const first = await begin();
    const second = await begin();
    await http().get(callback).expect(401);
    await http()
      .get(callback)
      .query({ code: 'test-code' })
      .set('Cookie', first.cookie)
      .expect(401);
    await http()
      .get(callback)
      .query({ code: 'test-code', state: first.state })
      .expect(401);
    await http()
      .get(callback)
      .query({ code: 'test-code', state: first.state })
      .set('Cookie', second.cookie)
      .expect(401);
    await http()
      .get(callback)
      .query({ code: 'test-code', state: first.state })
      .set('Cookie', `${first.cookie}; ${second.cookie}`)
      .expect(401);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('consumes a valid state before exchanging the code, even when the login fails', async () => {
    const { state, cookie } = await begin();
    const signIn = () =>
      http()
        .get(callback)
        .query({ code: 'test-code', state })
        .set('Cookie', cookie);
    const responses = await Promise.all([
      signIn().expect(401),
      signIn().expect(401),
    ]);
    expect(exchange).toHaveBeenCalledTimes(1);
    const accepted = responses.find(
      (response) => response.body.message === 'Perfil de Google simulado',
    );
    expect(accepted?.headers['set-cookie']?.[0]).toMatch(
      /^marsys-oauth-state=;/,
    );
  });

  it('rejects an expired state before exchanging the code', async () => {
    const { state, cookie } = await begin();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 301_000);
    try {
      await http()
        .get(callback)
        .query({ code: 'test-code', state })
        .set('Cookie', cookie)
        .expect(401);
      expect(exchange).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
});
