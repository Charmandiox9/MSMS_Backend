import { resolve } from 'node:path';
import { readLegacyAccessImportArguments } from './legacy-access-import-arguments.util';

describe('readLegacyAccessImportArguments', () => {
  it('requires an explicit Access source path', () => {
    expect(() => readLegacyAccessImportArguments([])).toThrow(
      'Debes indicar el archivo Access con --file.',
    );
  });

  it('rejects a missing source path', () => {
    expect(() => readLegacyAccessImportArguments(['--file'])).toThrow(
      'Indica una ruta válida después de --file.',
    );
  });

  it('resolves the source path and defaults to a local dry run', () => {
    const result = readLegacyAccessImportArguments([
      '--file',
      'test-data/source.mdb',
    ]);

    expect(result).toEqual({
      filePath: resolve('test-data/source.mdb'),
      apply: false,
      target: 'local',
    });
  });

  it('accepts an explicit development target and apply flag', () => {
    const result = readLegacyAccessImportArguments([
      '--file',
      'test-data/source.mdb',
      '--target=development',
      '--apply',
    ]);

    expect(result).toEqual({
      filePath: resolve('test-data/source.mdb'),
      apply: true,
      target: 'development',
    });
  });

  it('rejects unknown and duplicate arguments', () => {
    expect(() =>
      readLegacyAccessImportArguments(['--file', 'source.mdb', '--force']),
    ).toThrow('La importación recibió un argumento desconocido.');
    expect(() =>
      readLegacyAccessImportArguments([
        '--file',
        'source.mdb',
        '--file',
        'other.mdb',
      ]),
    ).toThrow('Indica --file una sola vez.');
    expect(() =>
      readLegacyAccessImportArguments([
        '--file',
        'source.mdb',
        '--target',
        'local',
        '--target=development',
      ]),
    ).toThrow('Indica --target una sola vez.');
  });
});
