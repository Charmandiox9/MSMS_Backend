import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  PayloadTooLargeException,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { Public } from '../auth/decorators/public.decorator';
import { StorageService } from './storage.service';
import { MAX_STORAGE_UPLOAD_BYTES } from './storage-transfer-token';

@Controller('storage/files')
export class StorageTransferController {
  constructor(private readonly storage: StorageService) {}

  // Public means no session is required: the short-lived, signed capability
  // authorizes exactly one key and operation, including the Forms integration.
  @Public()
  @Put('upload')
  @HttpCode(204)
  async upload(
    @Query('token') token: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const claims = this.storage.verifyTransfer(token, 'upload');
    const contentType = request
      .get('content-type')
      ?.split(';')[0]
      .trim()
      .toLowerCase();
    if (!contentType || contentType !== claims.contentType)
      throw new BadRequestException(
        'El tipo de archivo no coincide con la URL',
      );
    const declaredLength = request.get('content-length');
    if (declaredLength && Number(declaredLength) > MAX_STORAGE_UPLOAD_BYTES)
      throw new PayloadTooLargeException('El archivo supera los 10 MiB');

    const abort = new AbortController();
    const onClose = () => {
      if (!response.writableFinished) abort.abort();
    };
    response.once('close', onClose);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      // Keep memory bounded even for chunked requests without Content-Length.
      for await (const part of request.iterator({ destroyOnReturn: false })) {
        const chunk = Buffer.isBuffer(part)
          ? part
          : Buffer.from(part as Uint8Array);
        size += chunk.length;
        if (size > MAX_STORAGE_UPLOAD_BYTES) {
          request.resume();
          throw new PayloadTooLargeException('El archivo supera los 10 MiB');
        }
        chunks.push(chunk);
      }
      if (!size) throw new BadRequestException('El archivo está vacío');
      await this.storage.uploadFile(
        claims.key,
        contentType,
        Buffer.concat(chunks, size),
        abort.signal,
      );
      response.setHeader('Cache-Control', 'private, no-store');
    } finally {
      response.off('close', onClose);
    }
  }

  @Public()
  @Get('download')
  async download(
    @Query('token') token: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const claims = this.storage.verifyTransfer(token, 'download');
    const abort = new AbortController();
    let stream: Readable | undefined;
    const onClose = () => {
      if (!response.writableFinished) {
        abort.abort();
        stream?.destroy();
      }
    };
    response.once('close', onClose);
    try {
      const file = await this.storage.downloadFile(claims.key, abort.signal);
      stream = file.body;
      file.body.once('close', () => response.off('close', onClose));
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader(
        'Content-Security-Policy',
        "sandbox; default-src 'none'",
      );
      const extension = extname(claims.key)
        .replace(/[^a-zA-Z0-9.]/g, '')
        .slice(0, 16);
      return new StreamableFile(file.body, {
        type: 'application/octet-stream',
        disposition: `attachment; filename="evidence${extension}"`,
        length: file.length,
      })
        .setErrorHandler(() => {
          if (response.destroyed) return;
          if (response.headersSent) {
            response.destroy();
            return;
          }
          response.removeHeader('Content-Length');
          response.status(503).end('No se pudo obtener el archivo');
        })
        .setErrorLogger(() => undefined);
    } catch (error) {
      response.off('close', onClose);
      throw error;
    }
  }
}
