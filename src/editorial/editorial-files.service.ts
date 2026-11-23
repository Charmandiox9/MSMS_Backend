import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EditorialFileKind,
  EditorialFileStatus,
  EditorialStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  signStorageTransfer,
  verifyStorageTransfer,
} from '../storage/storage-transfer-token';
import { EditorialAccessGuard } from './editorial-access.guard';
import { editorialAudience } from './editorial-visibility';
import {
  editorialFileRules,
  validateEditorialFile,
} from './editorial-file-validation';
import type { ReserveEditorialFile } from './editorial-files.dto';

const expiresIn = 900;
const orphanLifetime = 24 * 60 * 60 * 1000;
const cleanupInterval = 15 * 60 * 1000;

@Injectable()
export class EditorialFilesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EditorialFilesService.name);
  private timer?: NodeJS.Timeout;
  private cleanup?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly access: EditorialAccessGuard,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      if (this.cleanup) return;
      this.cleanup = this.removeExpiredFiles()
        .catch(() =>
          this.logger.warn(
            'No se pudieron limpiar las cargas editoriales pendientes',
          ),
        )
        .finally(() => {
          this.cleanup = undefined;
        });
    }, cleanupInterval);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.cleanup;
  }

  async reserve(input: ReserveEditorialFile, userId: string) {
    const fileName = input.fileName.trim();
    const rules = editorialFileRules[input.kind];
    if (
      /[\\/\u0000-\u001f\u007f]/u.test(fileName) ||
      extname(fileName).toLowerCase() !== rules.extension
    ) {
      throw new BadRequestException(
        'El nombre de archivo no corresponde al formato seleccionado',
      );
    }
    if (
      Boolean(input.videoId) !==
      (input.kind === EditorialFileKind.CAPTIONS)
    ) {
      throw new BadRequestException(
        'Solo los subtítulos deben identificar una cápsula',
      );
    }
    const entry = await this.prisma.editorialEntry.findUnique({
      where: { id: input.entryId },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException('Entrada editorial no encontrada');

    const id = randomUUID();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (input.videoId) {
            const video = await tx.editorialFile.findFirst({
              where: {
                id: input.videoId,
                entryId: entry.id,
                kind: EditorialFileKind.VIDEO,
                status: EditorialFileStatus.READY,
                OR: [{ authorId: userId }, { revisions: { some: {} } }],
              },
              select: { id: true },
            });
            if (!video)
              throw new BadRequestException(
                'Selecciona una cápsula validada de esta entrada',
              );
          }
          const file = await tx.editorialFile.create({
            data: {
              id,
              key: `editorial/${entry.id}/${id}${rules.extension}`,
              entryId: entry.id,
              authorId: userId,
              kind: input.kind,
              language: input.language,
              videoId: input.videoId ?? null,
              fileName,
            },
            select: {
              id: true,
              status: true,
              kind: true,
              fileName: true,
              language: true,
              videoId: true,
            },
          });
          return {
            ...file,
            maxBytes: rules.maxBytes,
            mime: rules.mime,
            uploadUrl: `/api/editorial/files/${file.id}/upload`,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2003'].includes(error.code)
      ) {
        throw new ConflictException(
          'El archivo asociado cambió. Vuelve a seleccionarlo',
        );
      }
      throw error;
    }
  }

  async upload(
    id: string,
    userId: string,
    contentType: string | undefined,
    contentLength: string | undefined,
    source: Readable,
    signal: AbortSignal,
  ) {
    const file = await this.prisma.editorialFile.findFirst({
      where: { id, authorId: userId },
    });
    if (!file || file.status === EditorialFileStatus.DELETING)
      throw new NotFoundException('Carga editorial no encontrada');
    const rules = editorialFileRules[file.kind];
    if (contentType?.split(';')[0].trim().toLowerCase() !== rules.mime)
      throw new BadRequestException(
        'El tipo de archivo no coincide con la carga',
      );
    if (
      contentLength !== undefined &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) === 0)
    ) {
      throw new BadRequestException('La longitud del archivo no es válida');
    }
    if (contentLength !== undefined && Number(contentLength) > rules.maxBytes)
      this.rejectLargeFile(rules.maxBytes);
    const fileView = {
      id,
      kind: file.kind,
      language: file.language,
      fileName: file.fileName,
      videoId: file.videoId,
      status: EditorialFileStatus.READY,
    };
    if (file.status === EditorialFileStatus.READY) {
      source.resume();
      return { ...fileView, size: file.size, duration: file.duration };
    }

    const claimed = await this.prisma.editorialFile.updateMany({
      where: { id, authorId: userId, status: EditorialFileStatus.PENDING },
      data: { status: EditorialFileStatus.UPLOADING },
    });
    if (!claimed.count)
      throw new ConflictException(
        'Ya existe una transferencia para este archivo',
      );

    let folder: string | undefined;
    try {
      folder = await mkdtemp(join(tmpdir(), 'marsys-editorial-'));
      const staged = join(folder, `upload${rules.extension}`);
      const checksum = createHash('md5');
      let size = 0;
      const limited = async function* () {
        for await (const part of source.iterator({ destroyOnReturn: false })) {
          const chunk = Buffer.isBuffer(part)
            ? part
            : Buffer.from(part as Uint8Array);
          size += chunk.length;
          if (size > rules.maxBytes)
            throw new PayloadTooLargeException(
              `El archivo supera el límite de ${rules.maxBytes} bytes`,
            );
          checksum.update(chunk);
          yield chunk;
        }
      };
      await pipeline(Readable.from(limited()), createWriteStream(staged), {
        signal,
      });
      if (
        size === 0 ||
        (contentLength !== undefined && size !== Number(contentLength))
      ) {
        throw new BadRequestException('El archivo está vacío o incompleto');
      }
      const ffprobe = this.config.get<string>(
        'EDITORIAL_FFPROBE_PATH',
        'ffprobe',
      );
      const duration = await validateEditorialFile(
        staged,
        file.kind,
        size,
        ffprobe,
        signal,
      );
      const stream = createReadStream(staged);
      try {
        await this.storage.uploadStream(
          file.key,
          rules.mime,
          stream,
          size,
          signal,
          checksum.digest('base64'),
        );
      } finally {
        stream.destroy();
      }
      await this.prisma.editorialFile.update({
        where: { id, status: EditorialFileStatus.UPLOADING },
        data: { status: EditorialFileStatus.READY, size, duration },
      });
      return { ...fileView, size, duration };
    } catch (error) {
      source.resume();
      await this.prisma.editorialFile
        .updateMany({
          where: { id, status: EditorialFileStatus.UPLOADING },
          data: { status: EditorialFileStatus.PENDING },
        })
        .catch(() =>
          this.logger.warn(
            'No se pudo restablecer una carga editorial interrumpida',
          ),
        );
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'No se pudo completar la transferencia',
      );
    } finally {
      if (folder)
        await rm(folder, { recursive: true, force: true, maxRetries: 3 }).catch(
          () =>
            this.logger.warn('No se pudo retirar una copia editorial temporal'),
        );
    }
  }

  async issueAccess(
    id: string,
    user: CurrentUserPayload,
    preview: boolean,
    suppliedRole?: string,
  ) {
    const role = preview
      ? this.access.requestedRole(user, suppliedRole)
      : await this.access.readerRole(user, suppliedRole);
    if (preview && (!role || !(await this.access.canManage(user.id, role)))) {
      throw new ForbiddenException(
        'El rol activo no puede previsualizar contenido editorial',
      );
    }
    await this.visibleFile(id, user.id, preview, role);
    const token = signStorageTransfer(
      {
        action: 'download',
        key: JSON.stringify([id, user.id, role ?? null, preview]),
        expiresAt: Date.now() + expiresIn * 1000,
      },
      this.ticketSecret(),
    );
    return {
      url: `/api/editorial/files/${id}/content?token=${encodeURIComponent(token)}`,
      expiresIn,
    };
  }

  async download(
    id: string,
    userId: string,
    token: string | undefined,
    requestedRange: string | undefined,
    signal: AbortSignal,
  ) {
    const claims = verifyStorageTransfer(
      token,
      'download',
      this.ticketSecret(),
    );
    const payload: unknown = JSON.parse(claims.key);
    if (
      !Array.isArray(payload) ||
      (payload.length !== 3 && payload.length !== 4) ||
      payload[0] !== id ||
      payload[1] !== userId ||
      (payload[2] !== null && typeof payload[2] !== 'string') ||
      (payload.length === 4 && typeof payload[3] !== 'boolean')
    ) {
      throw new UnauthorizedException(
        'El acceso temporal no corresponde al archivo',
      );
    }
    const role = typeof payload[2] === 'string' ? payload[2] : undefined;
    // Older tickets only carried a role when issued for editorial preview.
    const preview = payload.length === 3 ? Boolean(role) : payload[3] === true;
    if (preview) {
      if (!role || !(await this.access.canManage(userId, role)))
        throw new ForbiddenException();
    } else if (role) {
      await this.access.assertAssignedRole(userId, role);
    }
    const file = await this.visibleFile(id, userId, preview, role);
    const range =
      file.kind === EditorialFileKind.VIDEO
        ? parseEditorialRange(requestedRange, file.size)
        : null;
    if (range === 'unsatisfiable')
      return { unsatisfiable: true as const, size: file.size };
    const result = await this.storage.downloadFile(
      file.key,
      signal,
      range ? `bytes=${range.start}-${range.end}` : undefined,
    );
    if (
      range &&
      (result.contentRange !==
        `bytes ${range.start}-${range.end}/${file.size}` ||
        result.length !== range.end - range.start + 1)
    ) {
      result.body.destroy();
      throw new ServiceUnavailableException(
        'No se pudo obtener el rango de video solicitado',
      );
    }
    return {
      unsatisfiable: false as const,
      file,
      range: result.contentRange,
      stream: result.body,
      length: result.length,
    };
  }

  async removeExpiredFiles(now = Date.now()) {
    const expired: Prisma.EditorialFileWhereInput = {
      revisions: { none: {} },
      captions: { none: {} },
      OR: [
        {
          status: { not: EditorialFileStatus.DELETING },
          updatedAt: { lt: new Date(now - orphanLifetime) },
        },
        {
          status: EditorialFileStatus.DELETING,
          updatedAt: { lt: new Date(now - cleanupInterval) },
        },
      ],
    };
    const files = await this.prisma.editorialFile.findMany({
      where: expired,
      orderBy: { updatedAt: 'asc' },
      take: 50,
      select: { id: true, key: true },
    });
    for (const file of files) {
      try {
        const claimed = await this.prisma.$transaction(
          (tx) =>
            tx.editorialFile.updateMany({
              where: { id: file.id, ...expired },
              data: { status: EditorialFileStatus.DELETING },
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        if (!claimed.count) continue;
        await this.storage.deleteFile(file.key);
        await this.prisma.editorialFile.deleteMany({
          where: { id: file.id, status: EditorialFileStatus.DELETING },
        });
      } catch {
        this.logger.warn(
          'No se pudo retirar un archivo editorial sin referencias',
        );
      }
    }
  }

  private async visibleFile(
    id: string,
    userId: string,
    preview: boolean,
    role?: string,
  ) {
    const file = await this.prisma.editorialFile.findFirst({
      where: {
        id,
        status: EditorialFileStatus.READY,
        ...(preview
          ? {
              OR: [{ authorId: userId }, { revisions: { some: {} } }],
            }
          : {
              revisions: {
                some: {
                  ...editorialAudience(role),
                  publishedOf: { is: { status: EditorialStatus.PUBLISHED } },
                },
              },
            }),
      },
    });
    if (!file || file.size === null)
      throw new NotFoundException('Archivo editorial no disponible');
    return { ...file, size: file.size };
  }

  private ticketSecret() {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret)
      throw new ServiceUnavailableException('Acceso temporal no configurado');
    return `marsys:editorial:v1:${secret}`;
  }

  private rejectLargeFile(maxBytes: number): never {
    throw new PayloadTooLargeException(
      `El archivo supera el límite de ${maxBytes} bytes`,
    );
  }
}

export function parseEditorialRange(value: string | undefined, size: number) {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return 'unsatisfiable';
  const suffixLength = match[1] ? null : Number(match[2]);
  const start =
    suffixLength === null ? Number(match[1]) : Math.max(0, size - suffixLength);
  const end =
    match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || start < 0 || start >= size || end < start)
    return 'unsatisfiable';
  return { start, end };
}
