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
}
