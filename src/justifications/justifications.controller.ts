import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JustificationStatus } from '@prisma/client';
import { JustificationsService, type FormJustificationInput } from './justifications.service';

type AuthenticatedRequest = Request & { user: { sub: string } };

class FormSubmissionDto implements FormJustificationInput {
  @IsString() @IsNotEmpty() @MaxLength(255) externalResponseId!: string;
  @IsEmail() studentEmail!: string;
  @IsString() @IsNotEmpty() absenceDate!: string;
  @IsString() @IsNotEmpty() subjectName!: string;
  @IsOptional() @IsString() subjectCode?: string;
  @IsOptional() @IsString() parallel?: string;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
  @IsString() @IsNotEmpty() evidenceKey!: string;
  @IsString() @IsNotEmpty() evidenceContentType!: string;
}

class DecisionDto {
  @IsEnum(JustificationStatus) status!: JustificationStatus;
  @IsOptional() @IsString() @MaxLength(1000) rejectionReason?: string;
}

@Controller('justifications')
export class JustificationsController {
  constructor(private readonly service: JustificationsService) {}

  @Public()
  @Post('inbox')
  receiveFormSubmission(
    @Headers('x-google-forms-secret') secret: string | undefined,
    @Body() body: FormSubmissionDto,
  ) {
    const expected = process.env.GOOGLE_FORMS_WEBHOOK_SECRET?.trim();
    if (!expected || secret?.trim() !== expected) {
      throw new UnauthorizedException('Webhook no autorizado');
    }
    return this.service.receiveFormSubmission(body);
  }

  @Get('inbox')
  @Roles('TEACHING_SUPPORT_COORDINATOR')
  listInbox() {
    return this.service.listInbox();
  }

  @Get()
  @Roles('TEACHING_SUPPORT_COORDINATOR')
  list(@Req() request: AuthenticatedRequest) {
    const status = request.query.status;
    return this.service.listJustifications(
      typeof status === 'string' && Object.values(JustificationStatus).includes(status as JustificationStatus)
        ? (status as JustificationStatus)
        : undefined,
    );
  }

  @Post('inbox/:id/open')
  @Roles('TEACHING_SUPPORT_COORDINATOR')
  open(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.service.openInboxEntry(id, request.user.sub);
  }

  @Patch(':id/decision')
  @Roles('TEACHING_SUPPORT_COORDINATOR')
  decide(@Param('id') id: string, @Body() body: DecisionDto, @Req() request: AuthenticatedRequest) {
    return this.service.decide(id, request.user.sub, body.status, body.rejectionReason);
  }

  @Get(':id/evidence-url')
  @Roles('TEACHING_SUPPORT_COORDINATOR')
  evidenceUrl(@Param('id') id: string) {
    return this.service.getEvidenceUrl(id);
  }
}
