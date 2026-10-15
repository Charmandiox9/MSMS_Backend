import assert from 'node:assert/strict';
const expected = Number(process.argv[2] ?? 200);
const base = 'http://localhost:18080';
let ready;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    ready = await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(7000) });
    if (ready.status === expected) break;
  } catch { /* Retry only during controlled local restart. */ }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
assert.equal(ready?.status, expected, 'readiness dependency status');
assert.equal((await fetch(`${base}/api/health/live`)).status, 200);
console.log(`PASS: readiness ${expected}, liveness 200.`);
