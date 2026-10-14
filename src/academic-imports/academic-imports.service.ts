import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ProjectStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type ImportRow = {
  row: number;
  data: Prisma.ProjectCreateInput;
  warnings: string[];
};
type RowIssue = { row: number; message: string };
type ParseResult = {
  valid: ImportRow[];
  errors: RowIssue[];
  duplicates: RowIssue[];
};

const text = (value: ExcelJS.CellValue | undefined): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value)
    return String(value.text).trim();
  if (typeof value === 'object' && 'result' in value) return text(value.result);
  return String(value).trim();
};

const date = (value: ExcelJS.CellValue | undefined): Date | null => {
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return new Date(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
    );
  const valueText = text(value);
  if (!valueText) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valueText);
  if (!match) return null;
  const [, y, m, d] = match;
  const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return parsed.getUTCFullYear() === Number(y) &&
    parsed.getUTCMonth() === Number(m) - 1 &&
    parsed.getUTCDate() === Number(d)
    ? parsed
    : null;
};

const decimal = (
  value: ExcelJS.CellValue | undefined,
): Prisma.Decimal | null => {
  const raw = text(value)
    .replace(/\s/g, '')
    .replace(/\$/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  if (!raw) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  return new Prisma.Decimal(raw);
};

@Injectable()
export class AcademicImportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async parseProjects(base64: string): Promise<ParseResult> {
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > 12 * 1024 * 1024)
      throw new BadRequestException(
        'El Excel está vacío o supera el límite de 12 MB',
      );
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException(
        'No se pudo leer el archivo. Selecciona un Excel .xlsx válido',
      );
    }
    const sheet = workbook.getWorksheet('proyectos') ?? workbook.worksheets[0];
    if (
      !sheet ||
      text(sheet.getRow(2).getCell(1).value).toLocaleUpperCase('es-CL') !==
        'AÑO'
    )
      throw new BadRequestException(
        'El archivo no coincide con la planilla de proyectos 2025-2026',
      );

    const valid: ImportRow[] = [];
    const errors: RowIssue[] = [];
    const seen = new Set<string>();
    for (let index = 3; index <= sheet.rowCount; index += 1) {
      const row = sheet.getRow(index);
      const title = text(row.getCell(6).value);
      const code = text(row.getCell(7).value) || null;
      if (!title && !text(row.getCell(1).value)) continue;
      const year = Number(text(row.getCell(1).value));
      const academicUnit = text(row.getCell(2).value);
      const issues: string[] = [];
      if (!Number.isInteger(year) || year < 1900 || year > 2200)
        issues.push('año inválido');
      if (!academicUnit) issues.push('unidad académica vacía');
      if (!title) issues.push('título vacío');
      const startsOn = date(row.getCell(4).value);
      const endsOn = date(row.getCell(5).value);
      const revisedEndsOn = date(row.getCell(19).value);
      const closedOn = date(row.getCell(20).value);
      if (text(row.getCell(4).value) && !startsOn)
        issues.push('fecha de inicio inválida');
      if (text(row.getCell(5).value) && !endsOn)
        issues.push('fecha de término inválida');
      if (text(row.getCell(19).value) && !revisedEndsOn)
        issues.push('fecha de modificación inválida');
      if (text(row.getCell(20).value) && !closedOn)
        issues.push('fecha de cierre inválida');
      if (
        startsOn &&
        [endsOn, revisedEndsOn, closedOn].some(
          (value) => value && value < startsOn,
        )
      )
        issues.push('una fecha de término precede al inicio');
      const amountValues = [12, 13, 14, 15, 16, 17, 18].map(
        (column) => row.getCell(column).value,
      );
      const amounts = amountValues.map(decimal);
      amountValues.forEach((value, index) => {
        if (text(value) && !amounts[index])
          issues.push(`monto inválido en la columna ${index + 1}`);
      });
      const duplicateKey = code
        ? `code:${code.toLocaleLowerCase()}`
        : `title:${year}:${title.toLocaleLowerCase()}`;
      if (seen.has(duplicateKey))
        issues.push('registro duplicado dentro del archivo');
      seen.add(duplicateKey);
      if (issues.length) {
        errors.push({ row: index, message: issues.join('; ') });
        continue;
      }
      const participants = new Map<string, { name: string; role: string }>();
      const director = text(row.getCell(8).value);
      if (director)
        participants.set(director.toLocaleLowerCase(), {
          name: director,
          role: 'Director/a',
        });
      for (const name of text(row.getCell(22).value)
        .split(/[;\n,]+/)
        .map((part) => part.trim())
        .filter(Boolean))
        if (!participants.has(name.toLocaleLowerCase()))
          participants.set(name.toLocaleLowerCase(), {
            name,
            role: 'Integrante',
          });
      const values = amounts.map((amount) => amount?.toString() ?? null);
      const warnings: string[] = [];
      if (!code) warnings.push('sin código de proyecto');
      if (amounts.some(Boolean))
        warnings.push(
          'montos interpretados como CLP según las columnas de la planilla',
        );
      const folder = text(row.getCell(21).value);
      const folderUrl = /^https?:\/\//i.test(folder) ? folder : null;
      if (folder && !folderUrl)
        warnings.push(
          'la carpeta no es una URL web; se conservará en observaciones',
        );
      valid.push({
        row: index,
        warnings,
        data: {
          reportingYear: year,
          academicUnit,
          resolution: text(row.getCell(3).value) || null,
          code,
          title,
          classification: text(row.getCell(9).value) || null,
          fundingSource: text(row.getCell(10).value) || null,
          program: text(row.getCell(11).value) || null,
          status: ProjectStatus.REGISTERED,
          startsOn,
          endsOn,
          revisedEndsOn,
          closedOn,
          currency: amounts.some(Boolean) ? 'CLP' : null,
          totalAmount: amounts[0],
          vraContribution: amounts[1],
          vridtContribution: amounts[2],
          recoveryAmount: amounts[3],
          facultyContribution: amounts[4],
          depreciationAmount: amounts[5],
          profitabilityAmount: amounts[6],
          folderUrl,
          notes: folder && !folderUrl ? `Carpeta de origen: ${folder}` : null,
          participants: { create: [...participants.values()] },
        },
      });
    }
    if (!valid.length && !errors.length)
      throw new BadRequestException(
        'La hoja no contiene proyectos para importar',
      );
    const codes = valid.flatMap(({ data }) => (data.code ? [data.code] : []));
    const existingProjects = valid.length
      ? await this.prisma.project.findMany({
          where: {
            OR: [
              ...(codes.length ? [{ code: { in: codes } }] : []),
              ...valid.map(({ data }) => ({
                title: data.title,
                reportingYear: data.reportingYear,
                academicUnit: data.academicUnit,
              })),
            ],
          },
          select: {
            code: true,
            title: true,
            reportingYear: true,
            academicUnit: true,
          },
        })
      : [];
    const existingCodes = new Set(
      existingProjects.flatMap(({ code: value }) =>
        value ? [value.toLocaleLowerCase()] : [],
      ),
    );
    const existingTitles = new Set(
      existingProjects.map(
        ({ title, reportingYear, academicUnit }) =>
          `${reportingYear}|${academicUnit.toLocaleLowerCase()}|${title.toLocaleLowerCase()}`,
      ),
    );
    const duplicates = valid.flatMap(({ data, row }) => {
      const codeExists =
        data.code && existingCodes.has(data.code.toLocaleLowerCase());
      const titleExists = existingTitles.has(
        `${data.reportingYear}|${data.academicUnit.toLocaleLowerCase()}|${data.title.toLocaleLowerCase()}`,
      );
      return codeExists || titleExists
        ? [
            {
              row,
              message: codeExists
                ? 'el código ya existe en el repositorio'
                : 'ya existe un proyecto con el mismo título, año y unidad',
            },
          ]
        : [];
    });
    const duplicateRows = new Set(duplicates.map(({ row }) => row));
    return {
      valid: valid.filter(({ row }) => !duplicateRows.has(row)),
      errors,
      duplicates,
    };
  }

  async previewProjects(base64: string) {
    const parsed = await this.parseProjects(base64);
    return {
      totalRows:
        parsed.valid.length + parsed.errors.length + parsed.duplicates.length,
      importable: parsed.valid.length,
      errors: parsed.errors,
      duplicates: parsed.duplicates,
      warnings: parsed.valid
        .flatMap(({ row, warnings }) =>
          warnings.map((message) => ({ row, message })),
        )
        .slice(0, 100),
      sample: parsed.valid
        .slice(0, 5)
        .map(({ row, data }) => ({
          row,
          title: data.title,
          code: data.code,
          reportingYear: data.reportingYear,
          academicUnit: data.academicUnit,
        })),
    };
  }

  async importProjects(base64: string) {
    const parsed = await this.parseProjects(base64);
    if (!parsed.valid.length)
      throw new BadRequestException(
        'No hay filas válidas para importar; revisa los errores y duplicados',
      );
    await this.prisma.$transaction(
      async (tx) => {
        for (const { data } of parsed.valid) await tx.project.create({ data });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return {
      imported: parsed.valid.length,
      skipped: parsed.errors.length + parsed.duplicates.length,
      errors: parsed.errors,
      duplicates: parsed.duplicates,
    };
  }
}
