import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { NestFactory } from '@nestjs/core';
import MDBReader, { type Value } from 'mdb-reader';
import { LegacyAccessImportModule } from './legacy-access-import.module';
import { LegacyAccessImportService } from './legacy-access-import.service';
import {
  LEGACY_ACCESS_COLUMNS,
  LEGACY_ACCESS_TABLE,
  parseLegacyAccessRows,
} from './legacy-access-import.util';
import {
  isLocalDatabase,
  isSameDatabaseEndpoint,
  parseEnvironmentValue,
} from './legacy-access-import-target.util';
import { readLegacyAccessImportArguments } from './legacy-access-import-arguments.util';

function loadBackendEnvironment(): void {
  for (const file of ['.env.local', '.env.pii', '.env.development', '.env']) {
    if (existsSync(file)) loadEnvFile(file);
  }
}

function readSourceRows(filePath: string) {
  const reader = new MDBReader(readFileSync(filePath));
  const tableNames = reader.getTableNames();
  if (!tableNames.includes(LEGACY_ACCESS_TABLE))
    throw new Error('El archivo no contiene la tabla de origen esperada.');

  const table = reader.getTable(LEGACY_ACCESS_TABLE);
  const availableColumns = new Set(table.getColumnNames());
  const requiredColumns = Object.values(LEGACY_ACCESS_COLUMNS);
  if (requiredColumns.some((column) => !availableColumns.has(column)))
    throw new Error('La tabla de origen no contiene las columnas esperadas.');

  return table.getData<Record<string, Value>>();
}

async function main(): Promise<void> {
  let app:
    | Awaited<ReturnType<typeof NestFactory.createApplicationContext>>
    | undefined;
  try {
    const args = readLegacyAccessImportArguments(process.argv.slice(2));
    const rows = readSourceRows(args.filePath);
    const parsed = parseLegacyAccessRows(rows);
    const report = {
      mode: args.apply ? 'apply' : 'dry-run',
      target: args.target,
      ...parsed.summary,
    };
    console.info(JSON.stringify(report, null, 2));

    if (!parsed.summary.canImport) {
      console.error(
        'La simulación encontró datos que requieren revisión. No se aplicaron cambios.',
      );
      process.exitCode = 1;
      return;
    }
    if (!args.apply) return;

    loadBackendEnvironment();
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString)
      throw new Error('No se encontró DATABASE_URL en la configuración local.');
    if (args.target === 'local' && !isLocalDatabase(connectionString))
      throw new Error(
        'El destino no es local. Para desarrollo, indica --target development.',
      );
    if (args.target === 'development') {
      const developmentEnvironment = readFileSync(
        resolve(process.cwd(), '.env.development'),
        'utf8',
      );
      const developmentUrl = parseEnvironmentValue(
        developmentEnvironment,
        'DATABASE_URL',
      );
      if (
        !developmentUrl ||
        !isSameDatabaseEndpoint(connectionString, developmentUrl)
      )
        throw new Error(
          'La conexión activa no coincide con DATABASE_URL de .env.development.',
        );
    }

    const application = await NestFactory.createApplicationContext(
      LegacyAccessImportModule,
      {
        logger: false,
      },
    );
    app = application;
    const importer = application.get(LegacyAccessImportService, {
      strict: false,
    });
    const writeSummary = await importer.importRecords(parsed.records);
    const linkSummary = await importer.linkExistingStudents();
    console.info(
      JSON.stringify(
        { mode: 'applied', ...writeSummary, ...linkSummary },
        null,
        2,
      ),
    );
  } catch {
    console.error(
      'Importación cancelada. Revisa la ruta del archivo, el catálogo de carreras, la migración y la configuración del destino.',
    );
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}

void main();
