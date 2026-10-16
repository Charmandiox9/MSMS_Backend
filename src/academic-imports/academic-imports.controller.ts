import { AcademicImportType } from '@prisma/client';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ACADEMIC_REPOSITORY_ROLES } from '../academic/repository-access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AcademicImportQueueService } from './academic-import-queue.service';
import { AcademicImportsService } from './academic-imports.service';
import { WorkbookImportDto } from './academic-imports.dto';

@Controller('academic/imports')
@Roles(...ACADEMIC_REPOSITORY_ROLES)
export class AcademicImportsController {
  constructor(
    private readonly service: AcademicImportsService,
    private readonly queue: AcademicImportQueueService,
  ) {}

  @Post('projects/preview')
  previewProjects(@Body() input: WorkbookImportDto) {
    return this.service.previewProjects(input.fileBase64);
  }

  @Post('projects/commit')
  @HttpCode(HttpStatus.ACCEPTED)
  importProjects(
    @Body() input: WorkbookImportDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.queue.enqueue(AcademicImportType.PROJECTS, input, user.id);
  }

  @Post('research/preview')
  previewResearch(@Body() input: WorkbookImportDto) {
    return this.service.previewResearch(input.fileBase64);
  }

  @Post('research/commit')
  @HttpCode(HttpStatus.ACCEPTED)
  importResearch(
    @Body() input: WorkbookImportDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.queue.enqueue(AcademicImportType.RESEARCH, input, user.id);
  }

  @Post('hourly/preview')
  previewHourly(@Body() input: WorkbookImportDto) {
    return this.service.previewHourly(input.fileBase64, input.teacherEmails);
  }

  @Post('hourly/commit')
  @HttpCode(HttpStatus.ACCEPTED)
  importHourly(
    @Body() input: WorkbookImportDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.queue.enqueue(AcademicImportType.HOURLY, input, user.id);
  }

  @Get('jobs/:id')
  getJobStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.queue.getStatus(id);
  }
}
