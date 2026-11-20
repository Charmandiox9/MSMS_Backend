import { isEmail } from 'class-validator';
import { isValidChileanRut, normalizeChileanRut } from './chilean-rut.util';

export const LEGACY_ACCESS_TABLE = 'Office_Address_List';

export const LEGACY_ACCESS_COLUMNS = {
  studentName: 'NOMBRE ESTUDIANTES',
  studentRut: 'RUT',
  thesisTopic: 'TEMA ',
  guideName: 'PROFESOR GUIA',
  reviewerOneName: 'PROFESOR CORRECTOR 1',
  reviewerTwoName: 'PROFESOR CORRECTOR 2',
  coGuideName: 'PROFESOR CO-GUIA',
  defenseDate: 'FECHA DEFENSA DE TESIS',
  studentEmail: 'EMAIL',
  studentPhone: 'NUMERO DE CONTACTO',
} as const;

export interface LegacyAccessTitulationRecord {
  studentName: string;
  studentRut: string | null;
  studentEmail: string | null;
  studentPhone: string | null;
  thesisTopic: string | null;
  guideName: string | null;
  coGuideName: string | null;
  reviewerOneName: string | null;
  reviewerTwoName: string | null;
  defenseDate: Date | null;
}

export interface LegacyAccessImportSummary {
  rowCount: number;
  missing: Record<string, number>;
  unavailable: Record<string, number>;
  invalid: Record<string, number>;
  duplicateRuts: number;
  canImport: boolean;
}

export interface LegacyAccessParseResult {
  records: LegacyAccessTitulationRecord[];
  summary: LegacyAccessImportSummary;
}

const SPANISH_MONTHS: Readonly<Record<string, number>> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const PHONE_PATTERN = /^\+?[0-9().\s-]{8,24}$/;

function cellText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.replace(/\s+/g, ' ').trim() || null;
}

function createCounter(keys: readonly string[]): Record<string, number> {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function toUtcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return date;
}

export function parseLegacyDefenseDate(value: string): Date | null {
  const normalized = value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es-CL')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const isoDate = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDate)
    return toUtcDate(
      Number(isoDate[1]),
      Number(isoDate[2]),
      Number(isoDate[3]),
    );

  const numericDate = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numericDate)
    return toUtcDate(
      Number(numericDate[3]),
      Number(numericDate[2]),
      Number(numericDate[1]),
    );

  const spanishDate = normalized.match(
    /(?:^|\D)(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})(?:\D|$)/,
  );
  if (!spanishDate) return null;

  const month = SPANISH_MONTHS[spanishDate[2]];
  return month
    ? toUtcDate(Number(spanishDate[3]), month, Number(spanishDate[1]))
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseLegacyAccessRows(
  rows: readonly unknown[],
): LegacyAccessParseResult {
  const missing = createCounter([
    'studentName',
    'studentRut',
    'studentEmail',
    'studentPhone',
    'thesisTopic',
    'guideName',
    'coGuideName',
    'reviewerOneName',
    'reviewerTwoName',
    'defenseDate',
  ]);
  const unavailable = {
    degree: rows.length,
    stage: rows.length,
    documentStatuses: rows.length,
  };
  const invalid = createCounter([
    'rowStructure',
    'studentName',
    'studentRut',
    'studentEmail',
    'studentPhone',
    'thesisTopic',
    'academicNames',
    'defenseDate',
  ]);
  const records: LegacyAccessTitulationRecord[] = [];
  const seenRuts = new Set<string>();
  let duplicateRuts = 0;

  for (const row of rows) {
    if (!isRecord(row)) {
      invalid.rowStructure += 1;
      continue;
    }

    const studentName = cellText(row[LEGACY_ACCESS_COLUMNS.studentName]);
    const rawRut = cellText(row[LEGACY_ACCESS_COLUMNS.studentRut]);
    const normalizedRut = rawRut ? normalizeChileanRut(rawRut) : null;
    const rawEmail = cellText(row[LEGACY_ACCESS_COLUMNS.studentEmail]);
    const studentEmail = rawEmail?.toLocaleLowerCase('es-CL') ?? null;
    const studentPhone = cellText(row[LEGACY_ACCESS_COLUMNS.studentPhone]);
    const thesisTopic = cellText(row[LEGACY_ACCESS_COLUMNS.thesisTopic]);
    const guideName = cellText(row[LEGACY_ACCESS_COLUMNS.guideName]);
    const coGuideName = cellText(row[LEGACY_ACCESS_COLUMNS.coGuideName]);
    const reviewerOneName = cellText(
      row[LEGACY_ACCESS_COLUMNS.reviewerOneName],
    );
    const reviewerTwoName = cellText(
      row[LEGACY_ACCESS_COLUMNS.reviewerTwoName],
    );
    const rawDefenseDate = cellText(row[LEGACY_ACCESS_COLUMNS.defenseDate]);
    const defenseDate = rawDefenseDate
      ? parseLegacyDefenseDate(rawDefenseDate)
      : null;

    if (!studentName) missing.studentName += 1;
    else if (studentName.length > 180) invalid.studentName += 1;

    if (!normalizedRut) missing.studentRut += 1;
    else if (!isValidChileanRut(normalizedRut)) invalid.studentRut += 1;
    else if (seenRuts.has(normalizedRut)) duplicateRuts += 1;
    else seenRuts.add(normalizedRut);

    if (!studentEmail) missing.studentEmail += 1;
    else if (!isEmail(studentEmail) || studentEmail.length > 254)
      invalid.studentEmail += 1;

    if (!studentPhone) missing.studentPhone += 1;
    else if (!PHONE_PATTERN.test(studentPhone)) invalid.studentPhone += 1;

    if (!thesisTopic) missing.thesisTopic += 1;
    else if (thesisTopic.length > 2000) invalid.thesisTopic += 1;

    if (!guideName) missing.guideName += 1;
    else if (guideName.length > 180) invalid.academicNames += 1;
    if (coGuideName) {
      if (coGuideName.length > 180) invalid.academicNames += 1;
    } else missing.coGuideName += 1;
    if (reviewerOneName) {
      if (reviewerOneName.length > 180) invalid.academicNames += 1;
    } else missing.reviewerOneName += 1;
    if (reviewerTwoName) {
      if (reviewerTwoName.length > 180) invalid.academicNames += 1;
    } else missing.reviewerTwoName += 1;

    if (!rawDefenseDate) missing.defenseDate += 1;
    else if (!defenseDate) invalid.defenseDate += 1;

    records.push({
      studentName: studentName ?? '',
      studentRut: normalizedRut,
      studentEmail,
      studentPhone,
      thesisTopic,
      guideName,
      coGuideName,
      reviewerOneName,
      reviewerTwoName,
      defenseDate,
    });
  }

  const hasRequiredFieldErrors = missing.studentName + missing.studentRut > 0;
  const hasInvalidValues = Object.values(invalid).some((count) => count > 0);

  return {
    records,
    summary: {
      rowCount: rows.length,
      missing,
      unavailable,
      invalid,
      duplicateRuts,
      canImport:
        rows.length > 0 &&
        records.length === rows.length &&
        !hasRequiredFieldErrors &&
        !hasInvalidValues &&
        duplicateRuts === 0,
    },
  };
}
