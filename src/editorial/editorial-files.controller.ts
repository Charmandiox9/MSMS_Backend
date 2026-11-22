import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { EditorialFileKind } from '@prisma/client';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { EditorialAccessGuard } from './editorial-access.guard';
import { editorialFileRules } from './editorial-file-validation';
import {
  EditorialFileAccessInput,
  ReserveEditorialFile,
} from './editorial-files.dto';
import { EditorialFilesService } from './editorial-files.service';

@Controller('editorial/files')
export class EditorialFilesController {
  constructor(private readonly files: EditorialFilesService) {}

  @Post()
  @UseGuards(EditorialAccessGuard)
  reserve(
    @Body() input: ReserveEditorialFile,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.files.reserve(input, user.id);
  }

  @Put(':id/upload')
  @UseGuards(EditorialAccessGuard)
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const abort = new AbortController();
    const close = () => {
      if (!response.writableFinished) abort.abort();
    };
    response.once('close', close);
    try {
      return await this.files.upload(
        id,
        user.id,
        request.get('content-type'),
        request.get('content-length'),
        request,
        abort.signal,
      );
    } finally {
      response.off('close', close);
    }
  }

  @Post(':id/access')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  access(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: EditorialFileAccessInput,
    @CurrentUser() user: CurrentUserPayload,
    @Headers('x-marsys-active-role') activeRole?: string,
  ) {
    return this.files.issueAccess(
      id,
      user,
      input?.preview === true,
      activeRole,
    );
  }

  @Get(':id/content')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Content-Type-Options', 'nosniff')
  async content(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('token') token: string | undefined,
    @Headers('range') range: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @Res({ passthrough: true }) response: Response,
  ) {
    const abort = new AbortController();
    const close = () => {
      if (!response.writableFinished) abort.abort();
    };
    response.once('close', close);
    try {
      const result = await this.files.download(
        id,
        user.id,
        token,
        range,
        abort.signal,
      );
      if (result.unsatisfiable) {
        response
          .status(416)
          .set('Content-Range', `bytes */${result.size}`)
          .set('Accept-Ranges', 'bytes');
        response.off('close', close);
        return;
      }

      result.stream.once('close', () => response.off('close', close));
      if (result.file.kind === EditorialFileKind.VIDEO)
        response.set('Accept-Ranges', 'bytes');
      if (result.range) response.status(206).set('Content-Range', result.range);
      if (result.file.kind === EditorialFileKind.PDF)
        response.attachment(result.file.fileName);
      const mime = editorialFileRules[result.file.kind].mime;
      return new StreamableFile(result.stream, {
        type: mime,
        length: result.length,
      })
        .setErrorHandler(() => {
          if (response.destroyed) return;
          if (response.headersSent) {
            response.destroy();
            return;
          }
          for (const header of [
            'Content-Length',
            'Content-Range',
            'Content-Disposition',
            'Content-Type',
          ])
            response.removeHeader(header);
          response.status(503).end('No se pudo obtener el archivo');
        })
        .setErrorLogger(() => undefined);
    } catch (error) {
      response.off('close', close);
      throw error;
    }
  }
}
