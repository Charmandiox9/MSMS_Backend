import { Body, Controller, Post } from '@nestjs/common';
import { ACADEMIC_REPOSITORY_ROLES } from '../academic/repository-access';
import { Roles } from '../auth/decorators/roles.decorator';
import { AcademicImportsService } from './academic-imports.service';
import { WorkbookImportDto } from './academic-imports.dto';

@Controller('academic/imports')
@Roles(...ACADEMIC_REPOSITORY_ROLES)
export class AcademicImportsController {
  constructor(private readonly service: AcademicImportsService) {}

  @Post('projects/preview')
  previewProjects(@Body() input: WorkbookImportDto) {
    return this.service.previewProjects(input.fileBase64);
  }

  @Post('projects/commit')
  importProjects(@Body() input: WorkbookImportDto) {
    return this.service.importProjects(input.fileBase64);
  }

  @Post('research/preview')
  previewResearch(@Body() input: WorkbookImportDto) {
    return this.service.previewResearch(input.fileBase64);
  }

  @Post('research/commit')
  importResearch(@Body() input: WorkbookImportDto) {
    return this.service.importResearch(input.fileBase64);
  }

  @Post('hourly/preview')
  previewHourly(@Body() input: WorkbookImportDto) {
    return this.service.previewHourly(input.fileBase64, input.teacherEmails);
  }

  @Post('hourly/commit')
  importHourly(@Body() input: WorkbookImportDto) {
    return this.service.importHourly(input.fileBase64, input.teacherEmails);
  }
}
