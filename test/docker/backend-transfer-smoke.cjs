const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const appRequire = createRequire('/app/package.json');
appRequire('reflect-metadata');
const { Module } = appRequire('@nestjs/common');
const { ConfigModule } = appRequire('@nestjs/config');
const { NestFactory } = appRequire('@nestjs/core');
const { StorageModule } = appRequire('./dist/storage/storage.module');
const { StorageService } = appRequire('./dist/storage/storage.service');

class StorageSmokeModule {}
Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), StorageModule] })(StorageSmokeModule);

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/marsys_docker_test');
  const publicBase = process.env.PUBLIC_API_URL || `${process.env.FRONTEND_URL}/api`;
  const origin = new URL(publicBase).origin;
  // Reach the same Nginx from inside Docker; signed links retain the public host.
  const throughProxy = (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, origin);
    return `http://nginx${parsed.pathname}${parsed.search}`;
  };
  const app = await NestFactory.createApplicationContext(StorageSmokeModule, { logger: false });
  try {
    const storage = app.get(StorageService);
    const issuedResponse = await fetch('http://nginx/api/storage/presigned-upload/forms', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'x-marsys-forms-secret': process.env.GOOGLE_FORMS_WEBHOOK_SECRET },
      body: JSON.stringify({ fileName: 'proxy-smoke.pdf', contentType: 'application/pdf' }),
    });
    assert.equal(issuedResponse.status, 201);
    const issued = await issuedResponse.json();
    const bytes = Buffer.from('%PDF-1.7\nMARSYS private backend transfer');
    const upload = await fetch(throughProxy(issued.uploadUrl), {
      method: 'PUT', headers: { 'Content-Type': 'application/pdf', Origin: origin }, body: bytes,
    });
    assert.equal(upload.status, 204);
    const signed = await storage.createPresignedDownload(issued.key);
    const download = await fetch(throughProxy(signed.downloadUrl));
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal(download.headers.get('cache-control'), 'private, no-store');
    assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.equal(download.headers.get('location'), null);
    const unsigned = new URL(signed.downloadUrl); unsigned.search = '';
    assert.equal((await fetch(throughProxy(unsigned))).status, 401);
    const changed = new URL(signed.downloadUrl);
    changed.searchParams.set('token', `${changed.searchParams.get('token')}invalid`);
    assert.equal((await fetch(throughProxy(changed))).status, 401);
    const anonymousS3 = await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_NAME}/${issued.key}`);
    assert.equal(anonymousS3.status, 403);
    console.log('PASS: Forms issuance, backend upload, private S3 roundtrip, streamed download, no redirect, invalid capabilities rejected, anonymous S3 denied.');
  } finally { await app.close(); }
}
main().catch(() => { console.error('FAIL: private backend storage integration.'); process.exitCode = 1; });
