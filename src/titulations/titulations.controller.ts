import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { MAX_STORAGE_UPLOAD_BYTES } from '../storage/storage-transfer-token';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreateTitulationDto,
  ListTitulationsDto,
  UpdateTitulationDto,
  FindTitulationStudentsDto,
} from './titulations.dto';
import { TitulationsService } from './titulations.service';
import { TitulationDraftKind } from './titulation-drafts';
import { TitulationDocumentsService } from './titulation-documents.service';
import {
  attachmentContentDisposition,
  isAllowedTitulationAttachmentType,
} from './titulation-attachments.util';
import type { TitulationUploadFile } from './titulation-attachments.util';
import { TitulationAttachmentsService } from './titulation-attachments.service';
import { CreateTitulationAttachmentDto } from './titulation-attachments.dto';

const TITULATION_READ_ROLES = [
  'ACADEMIC_SECRETARY',
  'ACADEMIC_PROCESS_ANALYST',
  'TEACHING_SUPPORT_COORDINATOR',
];

const TITULATION_MANAGE_ROLES = [
  'ACADEMIC_SECRETARY',
  'TEACHING_SUPPORT_COORDINATOR',
];

@Controller('academic/titulations')
export class TitulationsController {
  constructor(
    private readonly service: TitulationsService,
    private readonly documents: TitulationDocumentsService,
    private readonly attachments: TitulationAttachmentsService,
  ) {}

  @Post('search')
  @Roles(...TITULATION_READ_ROLES)
  async search(
    @Body() query: ListTitulationsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.list(query, await this.service.canViewRut(user.id));
  }

  @Get('filters')
  @Roles(...TITULATION_READ_ROLES)
  @Header('Cache-Control', 'private, no-store')
  filterOptions() {
    return this.service.filterOptions();
  }

  @Post('students/search')
  @Roles(...TITULATION_MANAGE_ROLES)
  @Header('Cache-Control', 'private, no-store')
  async findStudents(
    @Body() query: FindTitulationStudentsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.findStudents(
      query.search,
      await this.service.canViewRut(user.id),
    );
  }

  @Get(':id')
  @Roles(...TITULATION_READ_ROLES)
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.get(id, await this.service.canViewRut(user.id));
  }

  @Get(':id/documents/:kind')
  @Roles(...TITULATION_MANAGE_ROLES)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', new ParseEnumPipe(TitulationDraftKind))
    kind: TitulationDraftKind,
  ) {
    const { content, filename } = await this.documents.generateDraft(id, kind);
    return new StreamableFile(content, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get(':id/attachments')
  @Roles(...TITULATION_MANAGE_ROLES)
  @Header('Cache-Control', 'private, no-store')
  listAttachments(@Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.list(id);
  }

  @Post(':id/attachments')
  @Roles(...TITULATION_MANAGE_ROLES)
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_STORAGE_UPLOAD_BYTES },
      fileFilter: (_request, file, callback) => {
        const allowed = isAllowedTitulationAttachmentType(
          file.originalname,
          file.mimetype,
        );
        callback(
          allowed
            ? null
            : new BadRequestException('Adjunta un archivo PDF o Word (.docx)'),
          allowed,
        );
      },
    }),
  )
  uploadAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateTitulationAttachmentDto,
    @UploadedFile() file: TitulationUploadFile | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.attachments.upload(
      id,
      file,
      input.documentKind,
      input.documentStatus,
      user.id,
    );
  }

  @Get(':id/attachments/:attachmentId/file')
  @Roles(...TITULATION_MANAGE_ROLES)
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "sandbox; default-src 'none'")
  async downloadAttachment(
    @Param('id', ParseUUIDPipe) processId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const abort = new AbortController();
    const onClose = () => {
      if (!response.writableFinished) abort.abort();
    };
    response.once('close', onClose);

    try {
      const file = await this.attachments.open(
        processId,
        attachmentId,
        abort.signal,
      );
      file.body.once('close', () => response.off('close', onClose));
      return new StreamableFile(file.body, {
        type: 'application/octet-stream',
        disposition: attachmentContentDisposition(file.originalName),
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
    } catch (error: unknown) {
      response.off('close', onClose);
      throw error;
    }
  }

  @Post()
  @Roles(...TITULATION_MANAGE_ROLES)
  create(
    @Body() input: CreateTitulationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(':id')
  @Roles(...TITULATION_MANAGE_ROLES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateTitulationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.update(id, input, user.id);
  }

  @Delete(':id')
  @Roles(...TITULATION_MANAGE_ROLES)
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }
}
