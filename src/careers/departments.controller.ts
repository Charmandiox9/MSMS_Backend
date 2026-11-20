import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ACADEMIC_REPOSITORY_ROLES } from '../academic/repository-access';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  DepartmentVersionDto,
  SaveDepartmentDto,
  UpdateDepartmentDto,
} from './departments.dto';
import { DepartmentsService } from './departments.service';

@Controller('academic/departments')
@Roles('ACADEMIC_SECRETARY')
export class DepartmentsController {
  constructor(private readonly service: DepartmentsService) {}

  @Get()
  @Roles(...ACADEMIC_REPOSITORY_ROLES, 'TEACHING_SUPPORT_COORDINATOR')
  list() {
    return this.service.list();
  }

  @Get('options')
  @Roles(...ACADEMIC_REPOSITORY_ROLES, 'TEACHING_SUPPORT_COORDINATOR')
  options() {
    return this.service.options();
  }

  @Post()
  create(@Body() input: SaveDepartmentDto) {
    return this.service.create(input);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateDepartmentDto,
  ) {
    return this.service.update(id, input);
  }

  @Delete(':id')
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: DepartmentVersionDto,
  ) {
    return this.service.delete(id, input.updatedAt);
  }
}
