import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EditorialFileKind } from '@prisma/client';
import { execFile } from 'node:child_process';
import { open, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

export const editorialFileRules = {
  PDF: {
    mime: 'application/pdf',
    maxBytes: 10 * 1024 * 1024,
    extension: '.pdf',
  },
  VIDEO: { mime: 'video/mp4', maxBytes: 50 * 1024 * 1024, extension: '.mp4' },
  CAPTIONS: { mime: 'text/vtt', maxBytes: 256 * 1024, extension: '.vtt' },
} satisfies Record<
  EditorialFileKind,
  { mime: string; maxBytes: number; extension: string }
>;

const probeFile = promisify(execFile);

export async function validateEditorialFile(
  path: string,
  kind: EditorialFileKind,
  size: number,
  ffprobe: string,
  signal: AbortSignal,
) {
  if (kind === EditorialFileKind.CAPTIONS) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(
        await readFile(path),
      );
    } catch {
      throw new BadRequestException('Los subtítulos deben usar UTF-8');
    }
    validateCaptions(text);
    return null;
  }

  const file = await open(path, 'r');
  const header = Buffer.alloc(12);
  try {
    await file.read(header, 0, header.length, 0);
    if (kind === EditorialFileKind.PDF) {
      const tail = Buffer.alloc(Math.min(size, 1024));
      await file.read(tail, 0, tail.length, size - tail.length);
      if (
        !/^%PDF-[12]\.\d(?:\r|\n)/.test(header.toString('ascii')) ||
        !/%%EOF\s*$/.test(tail.toString('latin1'))
      ) {
        throw new BadRequestException(
          'El archivo no tiene una estructura PDF válida',
        );
      }
      return null;
    }
  } finally {
    await file.close();
  }
  if (
    header.toString('ascii', 4, 8) !== 'ftyp' ||
    header.toString('ascii', 8, 12) === 'qt  '
  ) {
    throw new BadRequestException('El archivo debe ser un video MP4');
  }

  let report: {
    format?: { duration?: string };
    streams?: {
      codec_name?: string;
      codec_type?: string;
      disposition?: { attached_pic?: number };
    }[];
  };
  try {
    const { stdout } = await probeFile(
      ffprobe,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-enable_drefs',
        '0',
        '-f',
        'mov',
        '-show_entries',
        'format=duration:stream=codec_name,codec_type:stream_disposition=attached_pic',
        '-of',
        'json',
        path,
      ],
      { timeout: 15000, maxBuffer: 128 * 1024, signal, windowsHide: true },
    );
    report = JSON.parse(stdout) as typeof report;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['ENOENT', 'EACCES', 'EPERM'].includes(String(error.code))
    ) {
      throw new ServiceUnavailableException(
        'El validador de video no está disponible',
      );
    }
    throw new BadRequestException('No fue posible leer la cápsula MP4');
  }
  const duration = Number(report.format?.duration);
  const videos =
    report.streams?.filter(
      (stream) =>
        stream.codec_type === 'video' && !stream.disposition?.attached_pic,
    ) ?? [];
  const audio =
    report.streams?.filter((stream) => stream.codec_type === 'audio') ?? [];
  if (
    !videos.length ||
    videos.some((stream) => stream.codec_name !== 'h264') ||
    audio.some((stream) => stream.codec_name !== 'aac')
  ) {
    throw new BadRequestException(
      'La cápsula requiere video H.264 y audio AAC si incluye audio',
    );
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > 180) {
    throw new BadRequestException('La cápsula debe durar hasta 3 minutos');
  }
  return duration;
}

function validateCaptions(text: string) {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .trimEnd()
    .split(/\n{2,}/);
  const header = blocks.shift();
  const timestamp = '(?:\\d{2,}:)?[0-5]\\d:[0-5]\\d\\.\\d{3}';
  const timing = new RegExp(
    `^(${timestamp})[ \\t]+-->[ \\t]+(${timestamp})(?:[ \\t].*)?$`,
  );
  let cueCount = 0;
  let previousStart = 0;
  if (
    !header ||
    !/^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(header) ||
    header.includes('-->') ||
    text.includes('\u0000')
  ) {
    throw new BadRequestException(
      'El archivo debe tener una cabecera WebVTT válida',
    );
  }
  for (const block of blocks) {
    if (/^NOTE(?:[ \t]|\n|$)/.test(block)) continue;
    const lines = block.split('\n');
    const timingIndex = lines[0].includes('-->') ? 0 : 1;
    const match = lines[timingIndex]?.match(timing);
    if (
      !match ||
      !lines
        .slice(timingIndex + 1)
        .join('')
        .trim()
    ) {
      throw new BadRequestException(
        'Cada subtítulo debe tener tiempos y texto válidos',
      );
    }
    const start = seconds(match[1]);
    const end = seconds(match[2]);
    if (!(start >= previousStart && end > start && Number.isFinite(end))) {
      throw new BadRequestException(
        'Revisa el orden y duración de los subtítulos',
      );
    }
    previousStart = start;
    cueCount++;
  }
  if (!cueCount) throw new BadRequestException('Incluye al menos un subtítulo');
}

function seconds(time: string) {
  return time.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}
