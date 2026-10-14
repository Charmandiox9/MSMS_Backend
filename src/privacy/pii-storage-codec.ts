import { Prisma } from '@prisma/client';
import { PiiCryptoService } from './pii-crypto.service';
import { normalizePiiLookup, piiPolicies } from './pii-policy';

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !(value instanceof Prisma.Decimal);
const models = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [model.name, model]),
);

/** Handles scalar PII and relation graphs without decrypting data in the database. */
export class PiiStorageCodec {
  constructor(private readonly crypto: PiiCryptoService) {}

  write(model: string, input: unknown): unknown {
    if (Array.isArray(input)) return input.map((row) => this.write(model, row));
    if (!object(input)) return input;
    const result = { ...input };
    const policy = piiPolicies[model];
    if (policy) {
      for (const field of policy.fields) {
        if (result[field] === undefined) continue;
        const raw =
          object(result[field]) && 'set' in result[field]
            ? result[field].set
            : result[field];
        if (raw !== null && typeof raw !== 'string')
          throw new Error('La operación de escritura PII no es compatible');
        const plain = raw;
        result[field] =
          plain === null
            ? null
            : this.crypto.encrypt(plain, `${model}.${field}`);
        const hash = policy.lookups[field];
        if (hash)
          result[hash] =
            plain === null
              ? null
              : this.crypto.blindIndex(
                  normalizePiiLookup(field, plain),
                  `${model}.${field}`,
                );
      }
      result.piiVersion = 1;
    }
    for (const relation of models
      .get(model)
      ?.fields.filter((field) => field.kind === 'object') ?? []) {
      const nested = result[relation.name];
      if (!object(nested)) continue;
      const value = { ...nested };
      for (const operation of [
        'create',
        'update',
        'upsert',
        'createMany',
        'updateMany',
        'connectOrCreate',
      ]) {
        if (value[operation] !== undefined)
          value[operation] = this.nestedWrite(
            relation.type,
            operation,
            value[operation],
          );
      }
      for (const operation of [
        'connect',
        'disconnect',
        'delete',
        'deleteMany',
        'set',
      ]) {
        if (value[operation] !== undefined)
          value[operation] = this.where(relation.type, value[operation]);
      }
      result[relation.name] = value;
    }
    return result;
  }

  private nestedWrite(
    model: string,
    operation: string,
    input: unknown,
  ): unknown {
    if (Array.isArray(input))
      return input.map((row) => this.nestedWrite(model, operation, row));
    if (!object(input)) return input;
    if (operation === 'create') return this.write(model, input);
    const value = { ...input };
    let wrapped = false;
    for (const field of ['data', 'create', 'update']) {
      if (value[field] !== undefined) {
        value[field] = this.write(model, value[field]);
        wrapped = true;
      }
    }
    if (value.where !== undefined) {
      value.where = this.where(model, value.where);
      wrapped = true;
    }
    return wrapped ? value : this.write(model, value);
  }

  where(model: string, input: unknown): unknown {
    if (Array.isArray(input)) return input.map((row) => this.where(model, row));
    if (!object(input)) return input;
    const result: Row = {};
    const policy = piiPolicies[model];
    for (const [field, value] of Object.entries(input)) {
      if (['AND', 'OR', 'NOT'].includes(field)) {
        result[field] = this.where(model, value);
        continue;
      }
      const relation = models
        .get(model)
        ?.fields.find((item) => item.name === field && item.kind === 'object');
      if (relation) {
        result[field] =
          object(value) &&
          ['some', 'none', 'every', 'is', 'isNot'].some((key) => key in value)
            ? Object.fromEntries(
                Object.entries(value).map(([key, condition]) => [
                  key,
                  this.where(relation.type, condition),
                ]),
              )
            : this.where(relation.type, value);
        continue;
      }
      const hash = policy?.lookups[field];
      if (hash) {
        result[hash] = this.lookup(model, field, value);
        continue;
      }
      if (policy?.fields.includes(field)) {
        if (
          value === null ||
          (object(value) &&
            Object.keys(value).length === 1 &&
            value.not === null)
        ) {
          result[field] = value;
          continue;
        }
        throw new Error(
          'Usa búsqueda PII en memoria para filtrar campos cifrados',
        );
      }
      // Composite unique selectors containing a protected name.
      const compound = models
        .get(model)
        ?.uniqueFields.find((fields) => fields.join('_') === field);
      if (compound && object(value)) {
        const renamed = compound
          .map((key) => policy?.lookups[key] ?? key)
          .join('_');
        result[renamed] = this.where(model, value);
      } else result[field] = value;
    }
    return result;
  }

  private lookup(model: string, field: string, input: unknown): unknown {
    if (input === null || input === undefined) return input;
    if (typeof input === 'string')
      return this.crypto.blindIndex(
        normalizePiiLookup(field, input),
        `${model}.${field}`,
      );
    if (Array.isArray(input))
      return input.map((value) => this.lookup(model, field, value));
    if (!object(input)) throw new Error('Filtro PII no válido');
    const result: Row = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === 'mode' && value === 'insensitive') continue;
      if (!['equals', 'in', 'notIn', 'not'].includes(key))
        throw new Error('Usa búsqueda PII en memoria para filtros parciales');
      result[key] = this.lookup(model, field, value);
    }
    return result;
  }

  read(model: string, input: unknown): unknown {
    if (Array.isArray(input)) return input.map((row) => this.read(model, row));
    if (!object(input)) return input;
    const result = { ...input };
    const policy = piiPolicies[model];
    for (const field of policy?.fields ?? []) {
      if (typeof result[field] === 'string')
        result[field] = this.crypto.decrypt(result[field], `${model}.${field}`);
    }
    for (const hash of Object.values(policy?.lookups ?? {}))
      delete result[hash];
    if (policy) delete result.piiVersion;
    for (const relation of models
      .get(model)
      ?.fields.filter((field) => field.kind === 'object') ?? []) {
      if (result[relation.name] !== undefined)
        result[relation.name] = this.read(relation.type, result[relation.name]);
    }
    return result;
  }

  args(model: string, operation: string, input: unknown): Row {
    if (!object(input)) return {};
    const result = { ...input };
    if (result.where) result.where = this.where(model, result.where);
    if (result.cursor) result.cursor = this.where(model, result.cursor);
    const distinct = Array.isArray(result.distinct)
      ? result.distinct
      : [result.distinct];
    if (
      distinct.some(
        (field) =>
          typeof field === 'string' &&
          piiPolicies[model]?.fields.includes(field),
      )
    )
      throw new Error(
        'No se permite distinguir datos personales cifrados en SQL',
      );
    for (const key of ['data', 'create', 'update'])
      if (result[key] !== undefined)
        result[key] = this.write(model, result[key]);
    if (piiPolicies[model] && ['aggregate', 'groupBy'].includes(operation)) {
      const serialized = JSON.stringify(result);
      if (
        piiPolicies[model].fields.some((field) =>
          serialized.includes(`"${field}"`),
        )
      )
        throw new Error(
          'No se permite agregar datos personales cifrados en SQL',
        );
    }
    this.readOptions(model, result);
    return result;
  }

  private readOptions(model: string, input: Row): void {
    const orders = Array.isArray(input.orderBy)
      ? input.orderBy
      : input.orderBy
        ? [input.orderBy]
        : [];
    for (const order of orders)
      if (object(order)) {
        for (const [field, value] of Object.entries(order)) {
          if (piiPolicies[model]?.fields.includes(field))
            throw new Error('Ordena datos personales después de descifrarlos');
          const relation = models
            .get(model)
            ?.fields.find(
              (item) => item.name === field && item.kind === 'object',
            );
          if (relation && object(value))
            this.readOptions(relation.type, { orderBy: value });
        }
      }
    for (const operation of ['select', 'include']) {
      const originalSelection = input[operation];
      if (!object(originalSelection)) continue;
      const selection = { ...originalSelection };
      input[operation] = selection;
      for (const relation of models
        .get(model)
        ?.fields.filter((field) => field.kind === 'object') ?? []) {
        const nested = selection[relation.name];
        if (!object(nested)) continue;
        const processed = { ...nested };
        if (processed.where)
          processed.where = this.where(relation.type, processed.where);
        this.readOptions(relation.type, processed);
        selection[relation.name] = processed;
      }
    }
  }
}
