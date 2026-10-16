// Run on the local Docker host: node test/docker/auto-migration-smoke.cjs
// Creates its own PostgreSQL/network; never reads production or development env.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const suffix = randomBytes(6).toString('hex');
const network = `marsys-migrate-test-${suffix}`;
const database = `${network}-db`;
const password = randomBytes(24).toString('hex');
const image = process.env.DEPLOYMENT_TEST_IMAGE || 'marsys-backend:dokploy-test';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'marsys-migrations-'));

function docker(args, required = true) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 180000 });
  if (required && result.status !== 0) {
    // Avoid printing docker arguments or database credentials on failure.
    throw new Error(`Docker test command failed (exit ${result.status}).`);
  }
  return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
}

const connection = `postgresql://migration_test:${password}@${database}:5432/migration_test`;
function start(extra = []) {
  return docker(['run', '--rm', '--network', network,
    '-e', `DATABASE_URL=${connection}`, '-e', `DIRECT_URL=${connection}`,
    ...extra, image, 'node', '-e', 'console.log("API_STARTED")'], false);
}

async function main() {
  try {
    docker(['network', 'create', network]);
    docker(['run', '-d', '--name', database, '--network', network,
      '-e', 'POSTGRES_USER=migration_test', '-e', 'POSTGRES_DB=migration_test',
      '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:17-alpine']);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (docker(['exec', database, 'pg_isready', '-U', 'migration_test'], false).status === 0) {
        ready = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'isolated PostgreSQL must be ready');

    const initial = start();
    assert.equal(initial.status, 0, 'fresh migrations must succeed');
    assert.ok(initial.output.indexOf('Database migrations complete') < initial.output.indexOf('API_STARTED'));
    assert.ok(initial.output.includes('API_STARTED'));
    const repeated = start();
    assert.equal(repeated.status, 0);
    assert.ok(repeated.output.includes('No pending migrations to apply'));

    // Simulate a later release with a new migration; API must start afterwards.
    const migrations = path.join(temporary, 'migrations');
    fs.cpSync(path.resolve('prisma/migrations'), migrations, { recursive: true });
    const pending = path.join(migrations, '20991231000000_deployment_smoke');
    fs.mkdirSync(pending);
    fs.writeFileSync(path.join(pending, 'migration.sql'), 'CREATE TABLE deployment_smoke (id integer PRIMARY KEY);');
    const mount = ['-v', `${migrations}:/app/prisma/migrations:ro`];
    const updated = start(mount);
    assert.equal(updated.status, 0);
    assert.ok(updated.output.includes('20991231000000_deployment_smoke'));
    assert.ok(updated.output.includes('API_STARTED'));

    // A failed future migration must prevent bootstrap and API startup.
    const broken = path.join(migrations, '20991231000001_broken_smoke');
    fs.mkdirSync(broken);
    fs.writeFileSync(path.join(broken, 'migration.sql'), 'SELECT * FROM table_that_does_not_exist;');
    const failed = start([...mount, '-e', 'BOOTSTRAP_ADMIN_EMAIL=invalid-test-address']);
    assert.notEqual(failed.status, 0);
    assert.ok(!failed.output.includes('Database migrations complete'));
    assert.ok(!failed.output.includes('API_STARTED'));
    const blocked = start(mount);
    assert.notEqual(blocked.status, 0, 'unresolved failed migration must block subsequent startup');
    assert.ok(!blocked.output.includes('API_STARTED'));
    console.log('PASS: fresh database, repeat startup, new migration, failed migration blocks API, failed state remains blocked.');
  } finally {
    docker(['rm', '-f', database], false);
    docker(['network', 'rm', network], false);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
