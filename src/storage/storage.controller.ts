import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
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

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

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
    @Headers('x-google-forms-secret') secret: string | undefined,
    @Body() dto: CreatePresignedUploadDto,
  ) {
    const expected = process.env.GOOGLE_FORMS_WEBHOOK_SECRET?.trim();
    if (!expected || secret?.trim() !== expected) {
      console.warn(
        `[FormsWebhook] storage unauthorized expectedLength=${expected?.length ?? 0} receivedLength=${secret?.trim().length ?? 0}`,
      );
      throw new UnauthorizedException('Webhook no autorizado');
    }

    return this.storageService.createPresignedUpload(dto.fileName, dto.contentType);
  }
}
