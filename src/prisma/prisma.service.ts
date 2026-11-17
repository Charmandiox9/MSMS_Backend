import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { PiiCryptoService } from '../privacy/pii-crypto.service';
import { piiExtension } from '../privacy/pii-extension';
import { PiiStorageCodec } from '../privacy/pii-storage-codec';
import { normalizePiiSearch, piiPolicies } from '../privacy/pii-policy';
import { normalizePostgresSslMode } from './postgres-connection-string';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    private config: ConfigService,
    private readonly crypto: PiiCryptoService,
  ) {
    const connectionString =
      config.get<string>('DATABASE_URL') || process.env.DATABASE_URL;
    const pool = new Pool({
      connectionString: connectionString
        ? normalizePostgresSslMode(connectionString)
        : connectionString,
    });
    const adapter = new PrismaPg(pool, { disposeExternalPool: true });
    super({ adapter });
    return this.$extends(
      piiExtension(new PiiStorageCodec(crypto)),
    ) as unknown as PrismaService;
  }

  async onModuleInit() {
    await this.$connect();
    for (const model of Object.keys(piiPolicies)) {
      const delegate = this.delegate(model);
      if (await delegate.count({ where: { piiVersion: 0 } }))
        throw new Error(
          `Completa la conversión PII de ${model} antes de iniciar la aplicación`,
        );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private delegate(model: string) {
    const name = model[0].toLowerCase() + model.slice(1);
    const client = this as unknown as Record<string, unknown>;
    return client[name] as {
      findMany(
        args: Record<string, unknown>,
      ): Promise<Record<string, unknown>[]>;
      count(args: Record<string, unknown>): Promise<number>;
    };
  }

  /** Exact substring verification after decryption; no plaintext search/sort keys are stored. */
  async findPiiIds(
    model: string,
    search: string,
    fields?: readonly string[],
  ): Promise<string[]> {
    const policy = piiPolicies[model];
    if (!policy?.searchable.length)
      throw new Error('El modelo no permite búsqueda PII');
    const searchableFields = fields ?? policy.searchable;
    if (
      !searchableFields.length ||
      searchableFields.some((field) => !policy.searchable.includes(field))
    )
      throw new Error('Los campos no permiten búsqueda PII');
    const rows = await this.delegate(model).findMany({
      select: {
        id: true,
        ...Object.fromEntries(searchableFields.map((field) => [field, true])),
      },
    });
    return rows
      .filter((row) =>
        searchableFields.some((field) => {
          if (typeof row[field] !== 'string') return false;
          const normalize = (value: string) => {
            const normalized = normalizePiiSearch(value);
            return field === 'rut'
              ? normalized.replace(/[.\s-]/g, '')
              : normalized;
          };
          return normalize(row[field]).includes(normalize(search));
        }),
      )
      .map((row) => String(row.id));
  }
}
