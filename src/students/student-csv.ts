import { BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';

export interface StudentCsvRow {
  line: number;
  name: string;
  email: string;
  nrcs: string[];
}

/** Semicolon/comma CSV, including quoted delimiters, escaped quotes and UTF-8 BOM. */
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
  const header = lines[0].text;
  const delimiter = header.includes(';') ? ';' : ',';
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
  const headers = cells(header, 1).map((value) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''),
  );
  const nameIndex = headers.findIndex((name) =>
    ['nombre', 'nombres', 'name'].includes(name),
  );
  const emailIndex = headers.findIndex((name) =>
    ['correo', 'email'].includes(name),
  );
  const nrcIndexes = headers.flatMap((name, index) =>
    /^nrc\d*$/.test(name) || name === 'nrcs' ? [index] : [],
  );
  if (
    nameIndex < 0 ||
    emailIndex < 0 ||
    !nrcIndexes.length ||
    new Set(headers).size !== headers.length
  )
    throw new BadRequestException(
      'Usa columnas nombre, correo y nrc1, nrc2… sin cabeceras repetidas',
    );
  if (nrcIndexes.length > 500)
    throw new BadRequestException('El CSV admite hasta 500 columnas de NRC');
  const emails = new Set<string>();
  return lines.slice(1).map(({ text, line }) => {
    const values = cells(text, line);
    if (values.length !== headers.length)
      throw new BadRequestException(
        `Fila ${line}: la cantidad de columnas no coincide con la cabecera`,
      );
    const name = values[nameIndex];
    const email = values[emailIndex].toLowerCase();
    const nrcs = [
      ...new Set(
        nrcIndexes.flatMap((index) =>
          values[index]
            .split(/[|,]/)
            .map((nrc) => nrc.trim())
            .filter(Boolean),
        ),
      ),
    ];
    if (!name || name.length > 200)
      throw new BadRequestException(
        `Fila ${line}: nombre obligatorio, máximo 200 caracteres`,
      );
    if (!isEmail(email) || email.length > 254)
      throw new BadRequestException(`Fila ${line}: correo inválido`);
    if (emails.has(email))
      throw new BadRequestException(
        `Fila ${line}: correo repetido en el archivo: ${email}`,
      );
    if (
      !nrcs.length ||
      nrcs.length > 500 ||
      nrcs.some((nrc) => nrc.length > 50)
    )
      throw new BadRequestException(
        `Fila ${line}: indica NRC válidos, máximo 500 por estudiante`,
      );
    emails.add(email);
    return { line, name, email, nrcs };
  });
}
