import { Prisma } from '@prisma/client';
import { PiiStorageCodec } from './pii-storage-codec';

export function piiExtension(codec: PiiStorageCodec) {
  return Prisma.defineExtension({
    name: 'authenticated-pii-storage',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const prepared = codec.args(model, operation, args);
          const result: unknown = await query(prepared);
          return codec.read(model, result);
        },
      },
    },
  });
}
