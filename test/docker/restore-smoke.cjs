const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const appRequire = createRequire('/app/package.json');
const { NestFactory } = appRequire('@nestjs/core');
const { AppModule } = appRequire('./dist/app.module');
const { PrismaService } = appRequire('./dist/prisma/prisma.service');
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.pathname, '/marsys_docker_test');
database.pathname = '/marsys_restore_test';
process.env.DATABASE_URL = database.toString();
process.env.DIRECT_URL = database.toString();
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const user = await app.get(PrismaService).user.findUnique({ where: { email: 'admin@example.test' } });
    assert.equal(user?.name, 'Docker Test Administrator');
    console.log('PASS: PostgreSQL dump restored to a separate database; PII decrypts with original keys.');
  } finally { await app.close(); }
}
main().catch(() => { console.error('FAIL: restore verification'); process.exitCode = 1; });
