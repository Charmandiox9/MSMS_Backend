import { BadRequestException } from '@nestjs/common';
import { extname, posix } from 'node:path';
import JSZip from 'jszip';
import { MAX_STORAGE_UPLOAD_BYTES } from '../storage/storage-transfer-token';

const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
};

export interface TitulationUploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface ValidatedTitulationAttachment {
  buffer: Buffer;
  originalName: string;
  contentType: string;
  size: number;
}

export function isAllowedTitulationAttachmentType(
  fileName: string,
  contentType: string,
): boolean {
  const extension = extname(fileName).toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[extension] === contentType.toLowerCase();
}

export function normalizeTitulationAttachmentFilename(value: string): string {
  const basename = posix.basename(value.replace(/\\/g, '/').normalize('NFC'));
  const fileName = Array.from(basename)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && (code < 127 || code > 159);
    })
    .join('')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .trim();
  const extension = extname(fileName).toLowerCase();
  if (!CONTENT_TYPE_BY_EXTENSION[extension])
    throw new BadRequestException('Adjunta un archivo PDF o Word (.docx)');

  const stem = Array.from(fileName.slice(0, -extension.length))
    .join('')
    .replace(/[\s.]+$/gu, '')
    .trim();
  const limitedStem = Array.from(stem).slice(0, 180).join('') || 'documento';
  const normalizedName = `${limitedStem}${extension}`;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(normalizedName)
    ? `documento-${normalizedName}`
    : normalizedName;
}

export function attachmentContentDisposition(fileName: string): string {
  const safeName = normalizeTitulationAttachmentFilename(fileName);
  const fallback = safeName.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

export async function validateTitulationAttachment(
  file: TitulationUploadFile | undefined,
): Promise<ValidatedTitulationAttachment> {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length)
    throw new BadRequestException('Selecciona un archivo para adjuntar');
  if (file.buffer.length > MAX_STORAGE_UPLOAD_BYTES)
    throw new BadRequestException('El archivo supera el límite de 10 MiB');
  if (file.size !== file.buffer.length)
    throw new BadRequestException('No se pudo validar el archivo');

  const originalName = normalizeTitulationAttachmentFilename(file.originalname);
  const extension = extname(originalName).toLowerCase();
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension];
  if (!isAllowedTitulationAttachmentType(originalName, file.mimetype))
    throw new BadRequestException('Adjunta un archivo PDF o Word (.docx)');

  const validContent =
    extension === '.pdf'
      ? file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))
      : await isValidWordDocument(file.buffer);
  if (!validContent)
    throw new BadRequestException('El archivo no es un documento válido');

  return { buffer: file.buffer, originalName, contentType, size: file.size };
}

async function isValidWordDocument(buffer: Buffer): Promise<boolean> {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  )
    return false;

  try {
    const archive = await JSZip.loadAsync(buffer, { checkCRC32: false });
    const entries = Object.values(archive.files);
    if (
      entries.length > 500 ||
      !archive.file('[Content_Types].xml') ||
      !archive.file('word/document.xml')
    )
      return false;

    return !entries.some(({ name }) =>
      name.toLowerCase().endsWith('/vbaproject.bin'),
    );
  } catch {
    return false;
  }
}
