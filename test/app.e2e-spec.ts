import request from 'supertest';
import { createTestApp, TestApp } from './support/test-app';

describe('AppController (e2e)', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it('/api (GET)', () => {
    return request(ctx.app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await ctx.close();
  });
});
