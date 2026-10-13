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
import { CreateTeacherDto } from './create-teacher.dto';
import { ListTeachersQueryDto } from './list-teachers-query.dto';
import { ToggleTeacherStatusDto, UpdateTeacherDto } from './update-teacher.dto';
import { UpdateCourseDto } from './update-course.dto';

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

  @Roles(...ACADEMIC_READERS)
  @Get()
  listTeachers(@Query() query: ListTeachersQueryDto) {
    return this.service.listTeachers(query);
  }

  @Roles(...ACADEMIC_READERS)
  @Get(':id')
  getTeacher(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getTeacher(id);
  }

  @Roles(...ACADEMIC_READERS)
  @Get(':id/schedule')
  getTeacherSchedule(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getTeacherSchedule(id);
  }

  @Post('import-csv')
  importCsv(@Body() body: CsvImportDto) {
    return this.service.importCsv(body.csv);
  }

  @Post('import-roster')
  importRoster(@Body() body: CsvImportDto) {
    return this.service.importTeacherRoster(body.csv);
  }

  @Post()
  createTeacher(@Body() body: CreateTeacherDto) {
    return this.service.createTeacher(body);
  }

  @Patch(':id')
  updateTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTeacherDto,
  ) {
    return this.service.updateTeacher(id, body);
  }

  @Patch(':id/status')
  toggleTeacherStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ToggleTeacherStatusDto,
  ) {
    return this.service.toggleTeacherStatus(id, body.isActive);
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
