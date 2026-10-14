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
import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AcademicService } from './academic.service';
import { ListTeachersQueryDto } from './list-teachers-query.dto';
import { UpdateCourseDto } from './update-course.dto';
import { ACADEMIC_REPOSITORY_ROLES } from './repository-access';

// ACADEMIC_RECORDS_VIEW (matriz RBAC): consulta de docentes, asignaturas y
// semestres. Las importaciones siguen reservadas a secretaría académica.
const ACADEMIC_READERS = [
  'ACADEMIC_SECRETARY',
  'ACADEMIC_PROCESS_ANALYST',
  'TEACHING_SUPPORT_COORDINATOR',
];

class CsvImportDto {
  @IsString()
  @IsNotEmpty()
  csv!: string;
}

class SemesterDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsDateString()
  startsOn!: string;

  @IsDateString()
  endsOn!: string;
}

@Controller('academic/teachers')
@Roles('ACADEMIC_SECRETARY')
export class AcademicController {
  constructor(private readonly service: AcademicService) {}

  @Roles(...ACADEMIC_REPOSITORY_ROLES)
  @Get()
  listTeachers(@Query() query: ListTeachersQueryDto) {
    return this.service.listTeachers(query);
  }

  @Roles(...ACADEMIC_REPOSITORY_ROLES)
  @Get(':id')
  getTeacher(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getTeacher(id);
  }

  @Roles(...ACADEMIC_REPOSITORY_ROLES)
  @Get(':id/schedule')
  getTeacherSchedule(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getTeacherSchedule(id);
  }

  @Post('import-csv')
  @Roles(...ACADEMIC_REPOSITORY_ROLES)
  importCsv(@Body() body: CsvImportDto) {
    return this.service.importCsv(body.csv);
  }

  @Post('import-roster')
  @Roles(...ACADEMIC_REPOSITORY_ROLES)
  importRoster(@Body() body: CsvImportDto) {
    return this.service.importTeacherRoster(body.csv);
  }
}

@Controller('academic/courses')
@Roles('ACADEMIC_SECRETARY')
export class AcademicCoursesController {
  constructor(private readonly service: AcademicService) {}

  @Roles(...ACADEMIC_READERS)
  @Get('options')
  scheduleOptions() {
    return this.service.scheduleOptions();
  }

  @Patch(':nrc')
  updateCourse(@Param('nrc') nrc: string, @Body() body: UpdateCourseDto) {
    return this.service.updateCourse(nrc, body);
  }

  @Roles(...ACADEMIC_READERS)
  @Get()
  listCourseSchedules() {
    return this.service.listCourseSchedules();
  }

  @Post('import-csv')
  importCourseSchedules(@Body() body: CsvImportDto) {
    return this.service.importCourseSchedules(body.csv);
  }
}

@Controller('academic/semesters')
@Roles('ACADEMIC_SECRETARY')
export class AcademicSemestersController {
  constructor(private readonly service: AcademicService) {}

  @Roles(...ACADEMIC_READERS)
  @Get()
  listSemesters() {
    return this.service.listSemesters();
  }

  @Post('activate')
  activateSemester(@Body() body: SemesterDto) {
    return this.service.activateSemester(body.name, body.startsOn, body.endsOn);
  }
}
