import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { readFileSync } from 'node:fs';

loadEnvFile('.env.docker-test');
assert.equal(process.env.DB_NAME, 'marsys_docker_test');
const base = process.env.FRONTEND_URL;
const { sessionId, downloadUrl } = JSON.parse(readFileSync('.audit-smoke-result.json', 'utf8'));
const cookie = `session=${sessionId}`;
const request = (path, options) => fetch(`${base}${path}`, options);
const expectStatus = async (path, status, options) => { const response = await request(path, options); assert.equal(response.status, status, path); return response; };

await expectStatus('/api/health/live', 200);
await expectStatus('/api/health/ready', 200);
assert.deepEqual(await (await expectStatus('/api/runtime-config', 200)).json(), { graphqlUrl: '/api/graphql' });
const login = await expectStatus('/es/login', 200);
assert.match(await login.text(), /\/api\/auth\/google/);
const oauth = await expectStatus('/api/auth/google', 302, { redirect: 'manual' });
assert.ok(oauth.headers.get('location').startsWith('https://accounts.google.com/'));
await expectStatus('/api/auth/session', 401);
for (let i = 0; i < 8; i++) {
  const response = await expectStatus('/api/auth/session', 200, { headers: { Cookie: cookie } });
  assert.deepEqual((await response.json()).roles, ['SYSTEM_ADMIN']);
}
await expectStatus('/api/academic/teachers', 401);
await expectStatus('/api/storage/presigned-upload/forms', 401, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: 'a.pdf', contentType: 'application/pdf' }) });
const uploadResponse = await expectStatus('/api/storage/presigned-upload/forms', 201, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-marsys-forms-secret': process.env.GOOGLE_FORMS_WEBHOOK_SECRET }, body: JSON.stringify({ fileName: 'test.pdf', contentType: 'application/pdf' }) });
const upload = await uploadResponse.json();
const contents = 'MARSYS disposable evidence roundtrip';
const preflight = await fetch(upload.uploadUrl, { method: 'OPTIONS', headers: { Origin: base, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
assert.ok(preflight.ok);
assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), base, 'Backend CORS must allow the application origin');
assert.ok((await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: contents })).ok);
const dynamic = new URL(upload.uploadUrl);
const deterministic = new URL(downloadUrl);
assert.equal(await (await fetch(downloadUrl)).text(), contents, 'Public signed download must preserve object bytes');
const unsigned = new URL(deterministic.origin + deterministic.pathname);
assert.equal((await fetch(unsigned)).status, 401, 'Unsigned backend download must be rejected');
assert.equal(dynamic.origin, new URL(base).origin, 'Uploads must use the application origin');
assert.equal(deterministic.origin, new URL(base).origin, 'Downloads must use the application origin');
await expectStatus('/api/academic/teachers/import-csv', 401, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: 'x'.repeat(2 * 1024 * 1024) }) });
await expectStatus('/api/auth/logout', 403, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://attacker.example.test' } });
const graphql = await expectStatus('/api/graphql', 200, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ __typename }' }) });
assert.equal((await graphql.json()).data.__typename, 'Query');
await expectStatus('/api/auth/logout', 204, { method: 'POST', headers: { Cookie: cookie, Origin: base } });
for (let i = 0; i < 4; i++) await expectStatus('/api/auth/session', 401, { headers: { Cookie: cookie } });
assert.equal(deterministic.host, dynamic.host);
console.log('PASS: proxy, frontend login, OAuth redirect, runtime config, REST/GraphQL, authentication, private signed upload, CSRF and shared logout.');
