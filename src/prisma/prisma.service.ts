import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { PiiCryptoService } from '../privacy/pii-crypto.service';
import { piiExtension } from '../privacy/pii-extension';
import { PiiStorageCodec } from '../privacy/pii-storage-codec';
import { normalizePiiSearch, piiPolicies } from '../privacy/pii-policy';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor(
    private config: ConfigService,
    private readonly crypto: PiiCryptoService,
  ) {
    const connectionString =
      config.get<string>('DATABASE_URL') || process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
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
  async findPiiIds(model: string, search: string): Promise<string[]> {
    const policy = piiPolicies[model];
    if (!policy?.searchable.length)
      throw new Error('El modelo no permite búsqueda PII');
    const rows = await this.delegate(model).findMany({
      select: {
        id: true,
        ...Object.fromEntries(policy.searchable.map((field) => [field, true])),
      },
    });
    const needle = normalizePiiSearch(search);
    return rows
      .filter((row) =>
        policy.searchable.some(
          (field) =>
            typeof row[field] === 'string' &&
            normalizePiiSearch(row[field]).includes(needle),
        ),
      )
      .map((row) => String(row.id));
  }
}
