const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/marsys_docker_test');
const { sessionId } = JSON.parse(readFileSync('/tmp/marsys-smoke.json', 'utf8'));
const expected = Number(process.argv[2] ?? 200);
async function main() {
  for (const url of ['http://127.0.0.1:3001/api/auth/session', 'http://marsys-validation-api-2:3001/api/auth/session']) {
    const result = await fetch(url, { headers: { Cookie: `session=${sessionId}` } });
    assert.equal(result.status, expected);
  }
  console.log(`PASS: both API replicas returned session status ${expected}.`);
}
main().catch(() => { console.error('FAIL: session replicas'); process.exitCode = 1; });
