import { resolve } from 'node:path';
import type { LegacyAccessImportTarget } from './legacy-access-import-target.util';

export interface LegacyAccessImportArguments {
  filePath: string;
  apply: boolean;
  target: LegacyAccessImportTarget;
}

export function readLegacyAccessImportArguments(
  args: readonly string[],
): LegacyAccessImportArguments {
  let filePath: string | undefined;
  let target: LegacyAccessImportTarget = 'local';
  let targetProvided = false;
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--file') {
      if (filePath) throw new Error('Indica --file una sola vez.');
      const value = args[index + 1];
      if (!value || value.startsWith('--'))
        throw new Error('Indica una ruta válida después de --file.');
      filePath = value;
      index += 1;
      continue;
    }

    if (argument === '--target' || argument.startsWith('--target=')) {
      if (targetProvided) throw new Error('Indica --target una sola vez.');
      const value =
        argument === '--target'
          ? args[index + 1]
          : argument.slice('--target='.length);
      if (!value || value.startsWith('--'))
        throw new Error('Indica el destino después de --target.');
      if (value !== 'local' && value !== 'development')
        throw new Error('El destino debe ser local o development.');
      target = value;
      targetProvided = true;
      if (argument === '--target') index += 1;
      continue;
    }

    if (argument === '--apply') {
      if (apply) throw new Error('Indica --apply una sola vez.');
      apply = true;
      continue;
    }

    throw new Error('La importación recibió un argumento desconocido.');
  }

  if (!filePath) throw new Error('Debes indicar el archivo Access con --file.');

  return { filePath: resolve(filePath), apply, target };
}
