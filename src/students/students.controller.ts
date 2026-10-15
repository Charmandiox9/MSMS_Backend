import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ImportStudentsDto,
  ListStudentsDto,
  StudentInputDto,
} from './students.dto';
import { StudentsService } from './students.service';

// REST matches the academic maintenance and CSV endpoints used by this dashboard.
@Controller('academic/students')
@Roles('ACADEMIC_SECRETARY')
export class StudentsController {
  constructor(private readonly service: StudentsService) {}
  @Get()
  @Roles(
    'ACADEMIC_SECRETARY',
    'ACADEMIC_PROCESS_ANALYST',
    'TEACHING_SUPPORT_COORDINATOR',
  )
  list(@Query() query: ListStudentsDto) {
    return this.service.list(query);
  }
  @Get(':id')
  @Roles(
    'ACADEMIC_SECRETARY',
    'ACADEMIC_PROCESS_ANALYST',
    'TEACHING_SUPPORT_COORDINATOR',
  )
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }
  @Post() create(@Body() input: StudentInputDto) {
    return this.service.save(input);
  }
  @Patch(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: StudentInputDto,
  ) {
    return this.service.save(input, id);
  }
  @Post('import-csv') importCsv(@Body() input: ImportStudentsDto) {
    return this.service.importCsv(input);
  }
}
