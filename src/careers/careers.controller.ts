import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ACADEMIC_REPOSITORY_ROLES } from '../academic/repository-access';
import {
  AddCurriculumVersionDto,
  CreateCareerDto,
  ImportCurriculumDto,
  UpdateCareerDto,
  UpdateCurriculumVersionDto,
} from './careers.dto';
import { CareersService } from './careers.service';

@Controller('academic/careers')
@Roles('ACADEMIC_SECRETARY')
export class CareersController {
  constructor(private readonly service: CareersService) {}

  @Get('course-options')
  @Roles(...ACADEMIC_REPOSITORY_ROLES)
  courseOptions() {
    return this.service.courseOptions();
  }

  @Get('options')
  @Roles(...ACADEMIC_REPOSITORY_ROLES)
  options() {
    return this.service.options();
  }

  @Get()
  @Roles(...ACADEMIC_REPOSITORY_ROLES, 'TEACHING_SUPPORT_COORDINATOR')
  list() {
    return this.service.list();
  }

  @Post()
  @Roles('ACADEMIC_SECRETARY')
  create(@Body() input: CreateCareerDto) {
    return this.service.create(input);
  }

  @Patch(':id')
  @Roles('ACADEMIC_SECRETARY')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateCareerDto,
  ) {
    return this.service.update(id, input);
  }

  @Post(':id/curricula')
  @Roles('ACADEMIC_SECRETARY')
  addCurriculumVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: AddCurriculumVersionDto,
  ) {
    return this.service.addVersion(id, input);
  }

  @Post(':id/curricula/import')
  @Roles('ACADEMIC_SECRETARY')
  importCurriculum(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ImportCurriculumDto,
  ) {
    return this.service.importVersion(id, input);
  }

  @Patch(':id/curricula/:versionId')
  @Roles('ACADEMIC_SECRETARY')
  updateCurriculumVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() input: UpdateCurriculumVersionDto,
  ) {
    return this.service.updateVersion(id, versionId, input);
  }
}
