import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PiiCryptoService } from '../src/privacy/pii-crypto.service';
import { PiiStorageCodec } from '../src/privacy/pii-storage-codec';
import { piiPolicies } from '../src/privacy/pii-policy';

if (!process.argv.includes('--apply')) {
  throw new Error(
    'Conversión no ejecutada: exige --apply y autorización sobre la base seleccionada',
  );
}

// Explicit maintenance tool. Never run automatically at application startup.
for (const file of ['.env.pii', '.env.development', '.env'])
  if (existsSync(file)) loadEnvFile(file);
const crypto = new PiiCryptoService(new ConfigService());
const codec = new PiiStorageCodec(crypto);
const client = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  }),
});
const rotate = process.argv.includes('--rotate');
let currentModel = 'inicio';

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'ERROR';
  if ('code' in error && typeof error.code === 'string') {
    if (!/^(P\d{4}|[A-Z_]+)$/.test(error.code)) return error.name;
    if (error.code !== 'P2002' || !('meta' in error) || !error.meta) {
      return error.code;
    }

    const safeTargets = new Set(['emailHash', 'googleIdHash']);
    const matched = new Set<string>();
    const inspect = (value: unknown, depth = 0): void => {
      if (depth > 6 || value === null || value === undefined) return;
      if (typeof value === 'string') {
        for (const field of safeTargets)
          if (value.includes(field)) matched.add(field);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) inspect(item, depth + 1);
        return;
      }
      if (typeof value === 'object')
        for (const [key, item] of Object.entries(value)) {
          inspect(key, depth + 1);
          inspect(item, depth + 1);
        }
    };
    inspect(error.meta);
    const uniqueTargets = [...matched];
    return uniqueTargets.length
      ? `${error.code}:${uniqueTargets.join(',')}`
      : error.code;
  }
  return error.name;
}

interface Delegate {
  findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  update(args: Record<string, unknown>): Promise<unknown>;
}
function delegate(tx: Prisma.TransactionClient, model: string): Delegate {
  return (tx as unknown as Record<string, unknown>)[
    model[0].toLowerCase() + model.slice(1)
  ] as Delegate;
}

async function main() {
  for (const [model, policy] of Object.entries(piiPolicies)) {
    currentModel = model;
    let cursor: string | undefined;
    let converted = 0;
    while (true) {
      const result = await client.$transaction(
        async (tx) => {
          const table = delegate(tx, model);
          const rows = await table.findMany({
            where: rotate ? {} : { piiVersion: 0 },
            select: {
              id: true,
              ...Object.fromEntries(
                policy.fields.map((field) => [field, true]),
              ),
            },
            orderBy: { id: 'asc' },
            take: 100,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          for (const row of rows) {
            const plain = Object.fromEntries(
              policy.fields.map((field) => {
                const value = row[field];
                return [
                  field,
                  typeof value === 'string' && crypto.isEncrypted(value)
                    ? crypto.decrypt(value, `${model}.${field}`)
                    : value,
                ];
              }),
            );
            await table.update({
              where: { id: row.id },
              data: codec.write(model, plain),
            });
          }
          return {
            count: rows.length,
            lastId: rows.length ? String(rows[rows.length - 1].id) : undefined,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 60_000,
        },
      );
      converted += result.count;
      if (!result.count) break;
      cursor = result.lastId;
    }
    console.log(`${model}: ${converted} registros convertidos`);
  }
}
main()
  .catch((error: unknown) => {
    // Prisma errors may contain original values. Do not print error objects.
    console.error(
      `La conversión PII falló en ${currentModel} (${safeErrorCode(error)}). Conserva las claves y revisa las restricciones, posibles duplicados y conectividad en el entorno autorizado.`,
    );
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
