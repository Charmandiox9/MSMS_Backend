import { BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';

export interface StudentCsvRow {
  line: number;
  registry: boolean;
  name: string;
  email: string;
  nrcs: string[];
  personalEmail?: string;
  rut?: string;
  admission?: number;
  paternalSurname?: string;
  maternalSurname?: string;
  birthDate?: string;
  careerCode?: string;
  careerName?: string;
}

/** Parses roster CSVs and the generic student registry CSV, with quoted fields and BOM. */
export function parseStudentCsv(csv: string): StudentCsvRow[] {
  if (Buffer.byteLength(csv, 'utf8') > 2_000_000)
    throw new BadRequestException('El archivo supera el máximo de 2 MB');
  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => text.trim());
  if (lines.length < 2)
    throw new BadRequestException('El CSV no contiene estudiantes');
  if (lines.length > 5001)
    throw new BadRequestException(
      'El CSV admite hasta 5000 estudiantes por importación',
    );
  const delimiter = lines[0].text.includes(';') ? ';' : ',';
  const cells = (text: string, line: number) => {
    const values: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === '"') {
        if (quoted && text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else quoted = !quoted;
      } else if (character === delimiter && !quoted) {
        values.push(value.trim());
        value = '';
      } else value += character;
    }
    if (quoted)
      throw new BadRequestException(`Fila ${line}: comillas sin cerrar`);
    values.push(value.trim());
    return values;
  };
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const headers = cells(lines[0].text, 1).map(normalize);
  if (new Set(headers).size !== headers.length)
    throw new BadRequestException('El CSV contiene cabeceras repetidas');
  const index = (...names: string[]) =>
    headers.findIndex((header) => names.includes(header));
  const nameIndex = index('nombre', 'nombres', 'name');
  const emailIndex = index('correo', 'email', 'emailestudiante');
  const nrcIndexes = headers.flatMap((name, position) =>
    /^nrc\d*$/.test(name) || name === 'nrcs' ? [position] : [],
  );
  const generic =
    index('admision') >= 0 && index('rut') >= 0 && index('appaterno') >= 0;
  const field = (row: string[], ...names: string[]) => {
    const position = index(...names);
    return position < 0 ? '' : row[position];
  };
  if (nameIndex < 0 || emailIndex < 0 || (!generic && !nrcIndexes.length))
    throw new BadRequestException(
      'Usa columnas nombre, correo y nrc1, nrc2… o el formato de padrón (codigo_carrera, carrera, ADMISION, RUT, NOMBRE, AP_PATERNO, AP_MATERNO, EMAIL_ESTUDIANTE, EMAIL_PERSONAL, FECHA_NACIMIENTO)',
    );
  if (nrcIndexes.length > 500)
    throw new BadRequestException('El CSV admite hasta 500 columnas de NRC');
  const seenEmails = new Set<string>();
  return lines.slice(1).map(({ text, line }) => {
    const values = cells(text, line);
    if (values.length !== headers.length)
      throw new BadRequestException(
        `Fila ${line}: la cantidad de columnas no coincide con la cabecera`,
      );
    const name = values[nameIndex].trim();
    const email = values[emailIndex].trim().toLowerCase();
    if (!name || name.length > 200)
      throw new BadRequestException(
        `Fila ${line}: nombre obligatorio, máximo 200 caracteres`,
      );
    if (!isEmail(email) || email.length > 254)
      throw new BadRequestException(`Fila ${line}: correo inválido`);
    if (seenEmails.has(email))
      throw new BadRequestException(
        `Fila ${line}: correo repetido en el archivo`,
      );
    const personalEmail = field(values, 'emailpersonal').toLowerCase();
    if (personalEmail && !isEmail(personalEmail))
      throw new BadRequestException(`Fila ${line}: correo personal inválido`);
    let admission: number | undefined;
    if (generic) {
      const rawAdmission = field(values, 'admision');
      if (
        !/^\d{6}$/.test(rawAdmission) ||
        !['10', '20'].includes(rawAdmission.slice(4))
      )
        throw new BadRequestException(
          `Fila ${line}: admisión debe tener seis dígitos y terminar en 10 o 20`,
        );
      admission = Number(rawAdmission);
    }
    const rawDate = field(values, 'fechanacimiento');
    let birthDate: string | undefined;
    if (rawDate) {
      const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(rawDate);
      const candidate = match
        ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
        : rawDate;
      const date = new Date(`${candidate}T00:00:00.000Z`);
      if (
        Number.isNaN(date.valueOf()) ||
        date.toISOString().slice(0, 10) !== candidate
      )
        throw new BadRequestException(
          `Fila ${line}: fecha de nacimiento inválida`,
        );
      birthDate = candidate;
    }
    const nrcs = [
      ...new Set(
        nrcIndexes.flatMap((position) =>
          values[position]
            .split(/[|,]/)
            .map((nrc) => nrc.trim())
            .filter(Boolean),
        ),
      ),
    ];
    if (
      nrcIndexes.length &&
      (!nrcs.length || nrcs.length > 500 || nrcs.some((nrc) => nrc.length > 50))
    )
      throw new BadRequestException(
        `Fila ${line}: indica NRC válidos, máximo 500 por estudiante`,
      );
    seenEmails.add(email);
    return {
      line,
      registry: generic,
      name,
      email,
      nrcs,
      ...(generic
        ? {
            personalEmail: personalEmail || undefined,
            rut: field(values, 'rut') || undefined,
            admission,
            paternalSurname: field(values, 'appaterno') || undefined,
            maternalSurname: field(values, 'apmaterno') || undefined,
            birthDate,
            careerCode: field(values, 'codigocarrera') || undefined,
            careerName: field(values, 'carrera') || undefined,
          }
        : {}),
    };
  });
}
