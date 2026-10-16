const { createRequire } = require('node:module');
const { writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const appRequire = createRequire('/app/package.json');
const { NestFactory } = appRequire('@nestjs/core');
const { CACHE_MANAGER } = appRequire('@nestjs/cache-manager');
const { createClient } = appRequire('@keyv/redis');
const { AppModule } = appRequire('./dist/app.module');
const { PrismaService } = appRequire('./dist/prisma/prisma.service');
const { AuthService } = appRequire('./dist/auth/auth.service');
const { SessionService } = appRequire('./dist/auth/session.service');
const { StorageService } = appRequire('./dist/storage/storage.service');
const { S3Client, PutObjectCommand } = appRequire('@aws-sdk/client-s3');

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/marsys_docker_test', 'Only the disposable test database is allowed');
  const first = await NestFactory.createApplicationContext(AppModule, { logger: false });
  let sessionId;
  try {
    const prisma = first.get(PrismaService);
    if (process.env.SMOKE_REUSE_USER !== 'true') assert.equal(await prisma.user.count(), 0, 'The test must start before any user exists');
    const user = await first.get(AuthService).validateGoogleUser({ googleId: 'docker-smoke-synthetic', email: 'admin@example.test', name: 'Docker Test Administrator' });
    assert.deepEqual(user.userRoles.map(({ role }) => role.code), ['SYSTEM_ADMIN']);
    assert.equal(await prisma.preloadedUser.count(), 0, 'OAuth provisioning consumes the encrypted administrator preload');
    const rows = await prisma.$queryRaw`SELECT email, "piiVersion" FROM "User" WHERE id = ${user.id}`;
    assert.ok(rows[0].email.startsWith('pii:v1:'));
    assert.equal(rows[0].piiVersion, 1);
    sessionId = await first.get(SessionService).create(first.get(AuthService).getSessionPayload(user));
    assert.equal(first.get(CACHE_MANAGER).stores.length, 1, 'No local fallback');
  } finally { await first.close(); }

  const second = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const redis = createClient({ url: process.env.REDIS_URL });
  try {
    assert.equal((await second.get(SessionService).get(sessionId)).email, 'admin@example.test');
    await redis.connect();
    const keys = (await redis.keys('*auth:session:pii:v1:*')).filter((key) => key.endsWith(sessionId));
    assert.equal(keys.length, 1);
    assert.ok((await redis.pTTL(keys[0])) > 86_000_000, 'Session TTL is measured in milliseconds');
    const stored = await redis.get(keys[0]);
    assert.ok(!stored.includes('admin@example.test'));
    assert.ok(stored.includes('pii:v1:'));
    const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY } });
    try { await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: 'uploads/docker-roundtrip.pdf', Body: 'MARSYS disposable evidence roundtrip', ContentType: 'application/pdf' })); } finally { s3.destroy(); }
    const download = await second.get(StorageService).createPresignedDownload('uploads/docker-roundtrip.pdf');
    writeFileSync('/tmp/marsys-smoke.json', JSON.stringify({ sessionId, downloadUrl: download.downloadUrl }), { mode: 0o600 });
    console.log('PASS: encrypted initial administrator, shared Redis session across application contexts, TTL, encrypted Redis payload and public S3 signing.');
  } finally { if (redis.isOpen) await redis.quit(); await second.close(); }
}
main().catch(() => { console.error('FAIL: Docker session integration.'); process.exitCode = 1; });
