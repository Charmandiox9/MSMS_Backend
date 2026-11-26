import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { StorageService } from './storage.service';

class CreatePresignedUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  contentType!: string;
}

class CreateFormsPresignedUploadDto extends CreatePresignedUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  externalResponseId!: string;
}

@Controller('storage')
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    private readonly config: ConfigService,
  ) {}

  // JUSTIFICATIONS_CREATE (matriz RBAC): solo quien registra justificaciones
  // sube evidencias.
  @Roles('TEACHING_SUPPORT_COORDINATOR')
  @Post('presigned-upload')
  createPresignedUpload(@Body() dto: CreatePresignedUploadDto) {
    return this.storageService.createPresignedUpload(
      dto.fileName,
      dto.contentType,
    );
  }

  @Public()
  @Post('presigned-upload/forms')
  createFormsPresignedUpload(
    @Headers('x-marsys-forms-secret') secret: string | undefined,
    @Headers('x-google-forms-secret') legacySecret: string | undefined,
    @Body() dto: CreateFormsPresignedUploadDto,
  ) {
    const expected = this.config
      .get<string>('GOOGLE_FORMS_UPLOAD_SECRET')
      ?.trim();
    const inboxSecret = this.config
      .get<string>('GOOGLE_FORMS_WEBHOOK_SECRET')
      ?.trim();
    const assistantshipSecret = this.config
      .get<string>('ASSISTANTSHIP_FORMS_WEBHOOK_SECRET')
      ?.trim();
    const receivedSecret = (secret ?? legacySecret)?.trim();
    if (
      !expected ||
      expected === inboxSecret ||
      expected === assistantshipSecret ||
      receivedSecret !== expected
    ) {
      throw new UnauthorizedException('Webhook no autorizado');
    }
    const externalResponseId = dto.externalResponseId.trim();
    if (!externalResponseId)
      throw new BadRequestException('Falta el identificador de respuesta');

    return this.storageService.createPresignedUpload(
      dto.fileName,
      dto.contentType,
      externalResponseId,
    );
  }
}
