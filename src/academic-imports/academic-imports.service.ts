import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  AcademicDegree,
  HourlyTeacherCategory,
  Prisma,
  ProjectStatus,
  ResearchOutputKind,
  TeacherCertification,
  TeachingComponent,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  calculateHourlyPayment,
  contractDate,
} from '../academic/hourly-payment-calculator';
import { TeacherImportEmailDto } from './academic-imports.dto';

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
type OutputImportRow = {
  row: number;
  data: Prisma.ResearchOutputCreateInput;
  doi: string | null;
  warnings: string[];
};
type OutputParseResult = {
  valid: OutputImportRow[];
  errors: RowIssue[];
  duplicates: RowIssue[];
};
type HourlyImportRow = {
  row: number;
  teacherId: string | null;
  teacherRut: string;
  teacherName: string;
  teacherEmail: string | null;
  nrc: string;
  component: TeachingComponent;
  parallel: string;
  hours: number;
  startsOn: Date;
  endsOn: Date;
  rateId: string;
  rate: Prisma.Decimal;
  monthlyOnSource: number | null;
  warnings: string[];
};
type HourlyParseResult = {
  semesterId: string;
  valid: HourlyImportRow[];
  errors: RowIssue[];
  duplicates: RowIssue[];
  unmatchedTeachers: { rut: string; name: string; rows: number[] }[];
  totalAmountClp: string;
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
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
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
const boolean = (value: ExcelJS.CellValue | undefined): boolean | null => {
  if (typeof value === 'boolean') return value;
  const normalized = text(value).toLocaleLowerCase('es-CL');
  if (['sí', 'si', 'true', '1'].includes(normalized)) return true;
  if (['no', 'false', '0'].includes(normalized)) return false;
  return null;
};

@Injectable()
export class AcademicImportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadWorkbook(base64: string) {
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
    return workbook;
  }

  private async parseProjects(base64: string): Promise<ParseResult> {
    const workbook = await this.loadWorkbook(base64);
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
      sample: parsed.valid.slice(0, 5).map(({ row, data }) => ({
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

  private async parseResearch(base64: string): Promise<OutputParseResult> {
    const workbook = await this.loadWorkbook(base64);
    const valid: OutputImportRow[] = [];
    const errors: RowIssue[] = [];
    const seenDois = new Set<string>();
    const seenOutputKeys = new Set<string>();
    const addOutput = (output: OutputImportRow) => {
      const key = `${output.data.kind}|${output.data.reportingYear}|${output.data.title.toLocaleLowerCase()}`;
      if (seenOutputKeys.has(key)) {
        errors.push({
          row: output.row,
          message: 'resultado repetido dentro del archivo',
        });
        return;
      }
      seenOutputKeys.add(key);
      valid.push(output);
    };
    const publications = workbook.getWorksheet('Publicaciones');
    if (
      !publications ||
      text(publications.getRow(5).getCell(3).value).toLocaleLowerCase(
        'es-CL',
      ) !== 'titulo'
    )
      throw new BadRequestException(
        'El archivo no coincide con la hoja Publicaciones de EPRYMA 2026',
      );

    for (
      let rowNumber = 6;
      rowNumber <= publications.rowCount;
      rowNumber += 1
    ) {
      const row = publications.getRow(rowNumber);
      const title = text(row.getCell(3).value);
      if (!title) continue;
      const doi = text(row.getCell(4).value) || null;
      const publicationDate = date(row.getCell(9).value);
      const rowErrors: string[] = [];
      if (text(row.getCell(9).value) && !publicationDate)
        rowErrors.push('fecha de publicación inválida');
      if (doi && seenDois.has(doi.toLocaleLowerCase()))
        rowErrors.push('DOI repetido dentro del archivo');
      if (doi) seenDois.add(doi.toLocaleLowerCase());
      if (rowErrors.length) {
        errors.push({ row: rowNumber, message: rowErrors.join('; ') });
        continue;
      }
      const authorNames = text(row.getCell(2).value)
        .split(/\s*;\s*/)
        .map((name) => name.trim())
        .filter(Boolean);
      const studentAuthor = text(row.getCell(13).value);
      if (
        studentAuthor &&
        !authorNames.some(
          (name) =>
            name.toLocaleLowerCase() === studentAuthor.toLocaleLowerCase(),
        )
      )
        authorNames.push(studentAuthor);
      const factorValue = row.getCell(8).value;
      const impact =
        typeof factorValue === 'number' &&
        Number.isFinite(factorValue) &&
        factorValue >= 0
          ? new Prisma.Decimal(factorValue)
          : null;
      const projectReferences = text(row.getCell(11).value);
      addOutput({
        row: rowNumber,
        doi,
        warnings: [
          ...(factorValue !== null && factorValue !== undefined && !impact
            ? ['factor de impacto no numérico; se dejará sin informar']
            : []),
          ...(projectReferences
            ? [
                `referencias a proyectos conservadas en observaciones: ${projectReferences.replace(/[\r\n]+/g, ', ')}`,
              ]
            : []),
        ],
        data: {
          kind: ResearchOutputKind.ARTICLE,
          reportingYear: publicationDate?.getUTCFullYear() ?? 2026,
          title,
          doi,
          journal: text(row.getCell(5).value) || null,
          issn: text(row.getCell(6).value) || null,
          quartile: text(row.getCell(7).value) || null,
          fiveYearImpactFactor: impact,
          publicationDate,
          indexation: text(row.getCell(10).value) || null,
          studentParticipation: boolean(row.getCell(12).value),
          internationalParticipation: boolean(row.getCell(14).value),
          notes: projectReferences
            ? `Proyectos asociados en el Excel: ${projectReferences}`
            : null,
          authors: authorNames.length
            ? {
                create: authorNames.map((name, index) => ({
                  name,
                  position: index + 1,
                  isStudent: name === studentAuthor ? true : null,
                })),
              }
            : undefined,
        },
      });
    }
    const books = workbook.getWorksheet('Libros');
    if (
      books &&
      text(books.getRow(3).getCell(4).value).toLocaleLowerCase('es-CL') ===
        'título del capítulo y/o libro'
    ) {
      for (let rowNumber = 4; rowNumber <= books.rowCount; rowNumber += 1) {
        const row = books.getRow(rowNumber);
        const title = text(row.getCell(4).value);
        if (!title) continue;
        const yearCell = row.getCell(3).value;
        const year =
          yearCell instanceof Date
            ? yearCell.getUTCFullYear()
            : Number(text(yearCell));
        if (!Number.isInteger(year) || year < 1900 || year > 2200) {
          errors.push({ row: rowNumber, message: 'Libros: año inválido' });
          continue;
        }
        const authorNames = text(row.getCell(2).value)
          .split(/\s*;\s*/)
          .map((name) => name.trim())
          .filter(Boolean);
        const studentAuthor = text(row.getCell(8).value);
        if (
          studentAuthor &&
          !authorNames.some(
            (name) =>
              name.toLocaleLowerCase() === studentAuthor.toLocaleLowerCase(),
          )
        )
          authorNames.push(studentAuthor);
        addOutput({
          row: rowNumber,
          doi: null,
          warnings: [],
          data: {
            kind: ResearchOutputKind.BOOK,
            reportingYear: year,
            title,
            publicationPlace: text(row.getCell(5).value) || null,
            publisher: text(row.getCell(6).value) || null,
            isbn: text(row.getCell(7).value) || null,
            studentParticipation: Boolean(studentAuthor) || null,
            authors: authorNames.length
              ? {
                  create: authorNames.map((name, index) => ({
                    name,
                    position: index + 1,
                    isStudent: name === studentAuthor ? true : null,
                  })),
                }
              : undefined,
          },
        });
      }
    }
    const intellectualProperty = workbook.getWorksheet('Propiedad intelectual');
    if (
      intellectualProperty &&
      text(intellectualProperty.getRow(1).getCell(2).value).toLocaleLowerCase(
        'es-CL',
      ) === 'tema'
    ) {
      for (
        let rowNumber = 2;
        rowNumber <= intellectualProperty.rowCount;
        rowNumber += 1
      ) {
        const row = intellectualProperty.getRow(rowNumber);
        const title = text(row.getCell(2).value);
        if (!title) continue;
        const phaseDate = date(row.getCell(6).value);
        if (text(row.getCell(6).value) && !phaseDate) {
          errors.push({
            row: rowNumber,
            message: 'Propiedad intelectual: fecha de fase inválida',
          });
          continue;
        }
        const authorName = text(row.getCell(1).value);
        const project = text(row.getCell(3).value);
        addOutput({
          row: rowNumber,
          doi: null,
          warnings: project
            ? [`referencia al proyecto conservada en observaciones: ${project}`]
            : [],
          data: {
            kind: ResearchOutputKind.INTELLECTUAL_PROPERTY,
            reportingYear: phaseDate?.getUTCFullYear() ?? 2026,
            title,
            intellectualPropertyType: text(row.getCell(4).value) || null,
            phase: text(row.getCell(5).value) || null,
            phaseDate,
            notes: project ? `Proyecto asociado en el Excel: ${project}` : null,
            authors: authorName
              ? { create: [{ name: authorName, position: 1 }] }
              : undefined,
          },
        });
      }
    }
    if (!valid.length && !errors.length)
      throw new BadRequestException(
        'La hoja Publicaciones no contiene filas para importar',
      );
    const existing = valid.length
      ? await this.prisma.researchOutput.findMany({
          where: {
            OR: valid.flatMap(({ doi, data }) => [
              ...(doi ? [{ doi }] : []),
              {
                kind: data.kind,
                reportingYear: data.reportingYear,
                title: data.title,
              },
            ]),
          },
          select: { doi: true, kind: true, reportingYear: true, title: true },
        })
      : [];
    const existingDois = new Set(
      existing.flatMap(({ doi }) => (doi ? [doi.toLocaleLowerCase()] : [])),
    );
    const existingOutputKeys = new Set(
      existing.map(
        ({ kind, reportingYear, title }) =>
          `${kind}|${reportingYear}|${title.toLocaleLowerCase()}`,
      ),
    );
    const duplicates = valid.flatMap(({ row, doi, data }) => {
      const duplicateDoi = doi && existingDois.has(doi.toLocaleLowerCase());
      const duplicateOutput = existingOutputKeys.has(
        `${data.kind}|${data.reportingYear}|${data.title.toLocaleLowerCase()}`,
      );
      return duplicateDoi || duplicateOutput
        ? [
            {
              row,
              message: duplicateDoi
                ? 'el DOI ya existe en el repositorio'
                : 'el resultado ya existe en el repositorio',
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

  async previewResearch(base64: string) {
    const parsed = await this.parseResearch(base64);
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
      sample: parsed.valid.slice(0, 5).map(({ row, data }) => ({
        row,
        title: data.title,
        reportingYear: data.reportingYear,
        kind: ResearchOutputKind.ARTICLE,
      })),
    };
  }

  async importResearch(base64: string) {
    const parsed = await this.parseResearch(base64);
    if (!parsed.valid.length)
      throw new BadRequestException(
        'No hay publicaciones válidas para importar',
      );
    await this.prisma.$transaction(
      async (tx) => {
        for (const { data } of parsed.valid)
          await tx.researchOutput.create({ data });
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

  private hourlyDegree(value: string): AcademicDegree | null {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-CL');
    if (normalized === 'profesional') return AcademicDegree.PROFESSIONAL;
    if (normalized === 'magister') return AcademicDegree.MASTER;
    if (normalized === 'doctor/a' || normalized === 'doctor')
      return AcademicDegree.DOCTOR;
    return null;
  }

  private validRut(rut: string): boolean {
    const [body, digit] = rut.split('-');
    if (!/^\d{7,8}$/.test(body ?? '') || !/^[\dK]$/.test(digit ?? ''))
      return false;
    let factor = 2;
    let sum = 0;
    for (const number of [...body].reverse()) {
      sum += Number(number) * factor;
      factor = factor === 7 ? 2 : factor + 1;
    }
    const rest = 11 - (sum % 11);
    const expected = rest === 11 ? '0' : rest === 10 ? 'K' : String(rest);
    return digit === expected;
  }

  private hourlyCertification(value: string): TeacherCertification | null {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-CL');
    if (
      !normalized ||
      normalized === 'sin cert.' ||
      normalized === 'sin cert' ||
      normalized === 'sin certificacion'
    )
      return TeacherCertification.NONE;
    if (normalized === 'nivel 1') return TeacherCertification.LEVEL_1;
    if (normalized === 'nivel 2') return TeacherCertification.LEVEL_2;
    if (normalized === 'nivel 3') return TeacherCertification.LEVEL_3;
    return null;
  }

  private hourlyComponent(value: string): TeachingComponent | null {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-CL')
      .replace(/\./g, '')
      .trim();
    const components: Record<string, TeachingComponent> = {
      cat: TeachingComponent.LECTURE,
      catedra: TeachingComponent.LECTURE,
      tall: TeachingComponent.WORKSHOP,
      taller: TeachingComponent.WORKSHOP,
      lab: TeachingComponent.LABORATORY,
      laboratorio: TeachingComponent.LABORATORY,
      terr: TeachingComponent.FIELDWORK,
      terreno: TeachingComponent.FIELDWORK,
      ayud: TeachingComponent.ASSISTANTSHIP,
      ayudantia: TeachingComponent.ASSISTANTSHIP,
    };
    return components[normalized] ?? null;
  }

  private async parseHourly(
    base64: string,
    teacherEmails: TeacherImportEmailDto[] = [],
  ): Promise<HourlyParseResult> {
    const workbook = await this.loadWorkbook(base64);
    const sheet = workbook.worksheets.find(
      (worksheet) =>
        worksheet.name.trim().toLocaleLowerCase('es-CL') === 'pagos',
    );
    if (
      !sheet ||
      text(sheet.getRow(4).getCell(6).value).toLocaleLowerCase('es-CL') !==
        'rut'
    )
      throw new BadRequestException(
        'El archivo no coincide con la hoja pagos de Planilla pagos PH 202620',
      );
    const semester = await this.prisma.academicSemester.findFirst({
      where: { isActive: true },
    });
    if (!semester)
      throw new BadRequestException(
        'Activa el semestre antes de importar contratos PH',
      );
    if (!/2026[- ]20/i.test(semester.name))
      throw new BadRequestException(
        'La planilla corresponde al semestre 2026-20; activa ese semestre antes de importarla',
      );
    const sourceRows: {
      row: number;
      rut: string;
      name: string;
      nrc: string;
      component: TeachingComponent;
      parallel: string;
      hours: number;
      startsOn: Date;
      endsOn: Date;
      category: HourlyTeacherCategory;
      degree: AcademicDegree;
      certification: TeacherCertification;
      monthly: number | null;
    }[] = [];
    const errors: RowIssue[] = [];
    for (let rowNumber = 5; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const nrc = text(row.getCell(1).value).replace(/\s+/g, ' ');
      if (!nrc) continue;
      const rut = text(row.getCell(6).value)
        .replace(/[.\s]/g, '')
        .toUpperCase();
      const hours = Number(text(row.getCell(10).value).replace(',', '.'));
      const categoryText = text(row.getCell(7).value).toLocaleLowerCase(
        'es-CL',
      );
      const component = this.hourlyComponent(text(row.getCell(3).value));
      const degree = this.hourlyDegree(text(row.getCell(8).value));
      const certification = this.hourlyCertification(
        text(row.getCell(9).value),
      );
      const startsOn = date(row.getCell(12).value);
      const endsOn = date(row.getCell(13).value);
      const category =
        categoryText === 'nuevo'
          ? HourlyTeacherCategory.NEW
          : categoryText === 'antiguo'
            ? HourlyTeacherCategory.EXISTING
            : null;
      const issues: string[] = [];
      if (!rut) issues.push('RUT vacío');
      else if (!this.validRut(rut)) issues.push('RUT inválido');
      if (!component) issues.push('componente docente desconocido');
      if (!degree) issues.push('grado académico desconocido');
      if (!certification) issues.push('certificación desconocida');
      if (!category) issues.push('categoría de profesor desconocida');
      if (!Number.isFinite(hours) || hours <= 0 || hours > 168)
        issues.push('horas directas inválidas');
      if (!startsOn || !endsOn) issues.push('fecha de contrato inválida');
      if (startsOn && endsOn && endsOn < startsOn)
        issues.push('el cierre precede al inicio');
      if (issues.length) {
        errors.push({ row: rowNumber, message: issues.join('; ') });
        continue;
      }
      sourceRows.push({
        row: rowNumber,
        rut,
        name: text(row.getCell(5).value),
        nrc,
        component: component!,
        parallel: text(row.getCell(4).value),
        hours,
        startsOn: startsOn!,
        endsOn: endsOn!,
        category: category!,
        degree: degree!,
        certification: certification!,
        monthly: text(row.getCell(11).value)
          ? Number.isFinite(Number(text(row.getCell(11).value)))
            ? Number(text(row.getCell(11).value))
            : null
          : null,
      });
    }
    if (!sourceRows.length && !errors.length)
      throw new BadRequestException(
        'La hoja pagos no contiene contratos para importar',
      );
    const [teachers, rates, schedules, assignments, enrollments] =
      await Promise.all([
        this.prisma.teacher.findMany({
          where: {
            rut: { in: [...new Set(sourceRows.map(({ rut }) => rut))] },
          },
          select: {
            id: true,
            rut: true,
            academicDegree: true,
            certification: true,
          },
        }),
        this.prisma.hourlyPayRate.findMany({
          where: { semesterId: semester.id },
        }),
        this.prisma.courseSchedule.findMany({
          where: { semesterId: semester.id },
          select: { nrc: true, courseId: true },
        }),
        this.prisma.teachingAssignment.findMany({
          where: { semesterId: semester.id },
          select: { teacherId: true, nrc: true, courseId: true, id: true },
        }),
        this.prisma.studentEnrollment.findMany({
          where: { semesterId: semester.id },
          select: { nrc: true, courseId: true },
        }),
      ]);
    const courseByNrc = new Map<string, string>();
    for (const item of [...schedules, ...assignments, ...enrollments])
      if (!courseByNrc.has(item.nrc)) courseByNrc.set(item.nrc, item.courseId);
    const teacherByRut = new Map(
      teachers.flatMap((teacher) =>
        teacher.rut
          ? [
              [
                teacher.rut.replace(/[.\s]/g, '').toUpperCase(),
                teacher,
              ] as const,
            ]
          : [],
      ),
    );
    const emailByRut = new Map<string, string>();
    for (const { rut, email } of teacherEmails) {
      const key = rut.replace(/[.\s]/g, '').toUpperCase();
      if (emailByRut.has(key))
        throw new BadRequestException('Solo puedes indicar un correo por RUT');
      emailByRut.set(key, email.trim().toLowerCase());
    }
    const uniqueEmails = [...new Set(emailByRut.values())];
    if (uniqueEmails.length !== emailByRut.size)
      throw new BadRequestException(
        'Cada profesor debe usar un correo distinto',
      );
    const existingEmails = uniqueEmails.length
      ? await this.prisma.teacher.findMany({
          where: { email: { in: uniqueEmails } },
          select: { email: true },
        })
      : [];
    const usedEmails = new Set(
      existingEmails.flatMap(({ email }) =>
        email ? [email.toLowerCase()] : [],
      ),
    );
    const valid: HourlyImportRow[] = [];
    const duplicates: RowIssue[] = [];
    const seen = new Set<string>();
    const unmatchedTeachers = new Map<
      string,
      { rut: string; name: string; rows: number[] }
    >();
    for (const item of sourceRows) {
      const teacher = teacherByRut.get(item.rut);
      const email = emailByRut.get(item.rut) ?? null;
      const key = `${item.rut}|${item.nrc}|${item.component}|${item.parallel}`;
      const rate = rates.find(
        (candidate) =>
          candidate.category === item.category &&
          candidate.academicDegree === item.degree &&
          candidate.certification === item.certification,
      );
      if (!teacher) {
        if (!item.name) {
          errors.push({
            row: item.row,
            message: 'falta el nombre para crear el profesor',
          });
          continue;
        }
        if (!email) {
          const unmatched = unmatchedTeachers.get(item.rut) ?? {
            rut: item.rut,
            name: item.name,
            rows: [],
          };
          unmatched.rows.push(item.row);
          unmatchedTeachers.set(item.rut, unmatched);
          errors.push({
            row: item.row,
            message: 'profesor nuevo: ingresa su correo para continuar',
          });
          continue;
        }
        if (usedEmails.has(email)) {
          const unmatched = unmatchedTeachers.get(item.rut) ?? {
            rut: item.rut,
            name: item.name,
            rows: [],
          };
          unmatched.rows.push(item.row);
          unmatchedTeachers.set(item.rut, unmatched);
          errors.push({
            row: item.row,
            message: 'el correo ingresado ya pertenece a otro profesor',
          });
          continue;
        }
      }
      if (!courseByNrc.has(item.nrc)) {
        errors.push({
          row: item.row,
          message: 'NRC no encontrado en el semestre activo',
        });
        continue;
      }
      if (!rate) {
        errors.push({
          row: item.row,
          message:
            'no hay una tarifa configurada para la categoría, grado y certificación de esta fila',
        });
        continue;
      }
      if (seen.has(key)) {
        duplicates.push({
          row: item.row,
          message: 'componente y paralelo repetidos dentro del archivo',
        });
        continue;
      }
      seen.add(key);
      const existingAssignment = assignments.find(
        (assignment) =>
          teacher &&
          assignment.teacherId === teacher.id &&
          assignment.nrc === item.nrc,
      );
      const existingContract =
        existingAssignment &&
        (await this.prisma.hourlyTeachingContract.findFirst({
          where: {
            teachingAssignmentId: existingAssignment.id,
            component: item.component,
            parallel: item.parallel,
          },
          select: { id: true },
        }));
      if (existingContract) {
        duplicates.push({
          row: item.row,
          message: 'el contrato ya existe en el semestre activo',
        });
        continue;
      }
      const firstMonth = new Date(
        Date.UTC(
          semester.startsOn.getUTCFullYear(),
          semester.startsOn.getUTCMonth(),
          1,
        ),
      );
      const lastMonth = new Date(
        Date.UTC(
          semester.endsOn.getUTCFullYear(),
          semester.endsOn.getUTCMonth() + 1,
          0,
        ),
      );
      if (item.startsOn < firstMonth || item.endsOn > lastMonth) {
        errors.push({
          row: item.row,
          message: 'las fechas están fuera de los meses del semestre activo',
        });
        continue;
      }
      const calculation = calculateHourlyPayment({
        hourlyRateClp: new Prisma.Decimal(rate.hourlyRateClp),
        directHours: new Prisma.Decimal(item.hours),
        startsOn: item.startsOn,
        endsOn: item.endsOn,
      });
      const expectedMonthly = new Prisma.Decimal(rate.hourlyRateClp)
        .mul(item.hours)
        .toNumber();
      const rowWarnings =
        item.monthly !== null &&
        Math.round(expectedMonthly) !== Math.round(item.monthly)
          ? [
              'el monto mensual del Excel difiere de la tarifa configurada; el cálculo usará la tarifa del semestre',
            ]
          : [];
      valid.push({
        row: item.row,
        teacherId: teacher?.id ?? null,
        teacherRut: item.rut,
        teacherName: item.name,
        teacherEmail: teacher ? null : email,
        nrc: item.nrc,
        component: item.component,
        parallel: item.parallel,
        hours: item.hours,
        startsOn: item.startsOn,
        endsOn: item.endsOn,
        rateId: rate.id,
        rate: new Prisma.Decimal(rate.hourlyRateClp),
        monthlyOnSource: item.monthly,
        warnings: rowWarnings,
      });
      void calculation;
    }
    const totals = valid.reduce(
      (sum, item) =>
        sum +
        Number(
          calculateHourlyPayment({
            hourlyRateClp: item.rate,
            directHours: new Prisma.Decimal(item.hours),
            startsOn: item.startsOn,
            endsOn: item.endsOn,
          }).totalAmountClp,
        ),
      0,
    );
    return {
      semesterId: semester.id,
      valid,
      errors,
      duplicates,
      unmatchedTeachers: [...unmatchedTeachers.values()],
      totalAmountClp: String(Math.round(totals)),
    };
  }

  async previewHourly(base64: string, teacherEmails?: TeacherImportEmailDto[]) {
    const parsed = await this.parseHourly(base64, teacherEmails);
    return {
      totalRows:
        parsed.valid.length + parsed.errors.length + parsed.duplicates.length,
      importable: parsed.valid.length,
      estimatedTotalClp: parsed.totalAmountClp,
      errors: parsed.errors,
      duplicates: parsed.duplicates,
      unmatchedTeachers: parsed.unmatchedTeachers,
      warnings: parsed.valid
        .flatMap(({ row, warnings }) =>
          warnings.map((message) => ({ row, message })),
        )
        .slice(0, 100),
      sample: parsed.valid
        .slice(0, 5)
        .map(({ row, nrc, component, parallel, hours }) => ({
          row,
          title: `${nrc} · ${component} ${parallel} · ${hours} h`,
          reportingYear: 2026,
        })),
    };
  }

  async importHourly(base64: string, teacherEmails?: TeacherImportEmailDto[]) {
    const parsed = await this.parseHourly(base64, teacherEmails);
    if (!parsed.valid.length)
      throw new BadRequestException('No hay contratos válidos para importar');
    await this.prisma.$transaction(
      async (tx) => {
        for (const item of parsed.valid) {
          let teacherId = item.teacherId;
          if (!teacherId) {
            const matchingRate = await tx.hourlyPayRate.findUnique({
              where: { id: item.rateId },
              select: { academicDegree: true, certification: true },
            });
            const createdTeacher = await tx.teacher.upsert({
              where: { rut: item.teacherRut },
              create: {
                rut: item.teacherRut,
                name: item.teacherName,
                email: item.teacherEmail!,
                academicDegree: matchingRate?.academicDegree,
                certification: matchingRate?.certification,
              },
              update: {},
              select: { id: true },
            });
            teacherId = createdTeacher.id;
          }
          const courseId =
            (
              await tx.courseSchedule.findFirst({
                where: { semesterId: parsed.semesterId, nrc: item.nrc },
                select: { courseId: true },
              })
            )?.courseId ??
            (
              await tx.teachingAssignment.findFirst({
                where: { semesterId: parsed.semesterId, nrc: item.nrc },
                select: { courseId: true },
              })
            )?.courseId ??
            (
              await tx.studentEnrollment.findFirst({
                where: { semesterId: parsed.semesterId, nrc: item.nrc },
                select: { courseId: true },
              })
            )?.courseId;
          if (!courseId)
            throw new BadRequestException(
              'Un NRC dejó de existir en el semestre activo; no se importó ningún contrato',
            );
          const assignment = await tx.teachingAssignment.upsert({
            where: {
              semesterId_teacherId_courseId_nrc: {
                semesterId: parsed.semesterId,
                teacherId,
                courseId,
                nrc: item.nrc,
              },
            },
            create: {
              semesterId: parsed.semesterId,
              teacherId,
              courseId,
              nrc: item.nrc,
            },
            update: {},
          });
          const teacher = await tx.teacher.findUnique({
            where: { id: teacherId },
            select: { academicDegree: true, certification: true },
          });
          if (teacher && (!teacher.academicDegree || !teacher.certification)) {
            const matchingRate = await tx.hourlyPayRate.findUnique({
              where: { id: item.rateId },
              select: { academicDegree: true, certification: true },
            });
            if (matchingRate)
              await tx.teacher.update({
                where: { id: teacherId },
                data: {
                  academicDegree:
                    teacher.academicDegree ?? matchingRate.academicDegree,
                  certification:
                    teacher.certification ?? matchingRate.certification,
                },
              });
          }
          await tx.hourlyTeachingContract.create({
            data: {
              semesterId: parsed.semesterId,
              teachingAssignmentId: assignment.id,
              payRateId: item.rateId,
              component: item.component,
              parallel: item.parallel,
              directHours: item.hours,
              startsOn: item.startsOn,
              endsOn: item.endsOn,
              hourlyRateClp: item.rate,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return {
      imported: parsed.valid.length,
      skipped: parsed.errors.length + parsed.duplicates.length,
      errors: parsed.errors,
      duplicates: parsed.duplicates,
      totalAmountClp: parsed.totalAmountClp,
    };
  }
}
