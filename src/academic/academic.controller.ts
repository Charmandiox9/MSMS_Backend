import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsDateString, IsNotEmpty, IsString } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AcademicService } from './academic.service';

// ACADEMIC_RECORDS_VIEW (matriz RBAC): consulta de docentes, asignaturas y
// semestres. Las importaciones siguen reservadas a secretaría académica.
const ACADEMIC_READERS = ['ACADEMIC_SECRETARY', 'ACADEMIC_PROCESS_ANALYST', 'TEACHING_SUPPORT_COORDINATOR'];

class CsvImportDto {
  @IsString()
  @IsNotEmpty()
  csv!: string;
}

class SemesterDto {
  @IsString()
  @IsNotEmpty()
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
  listTeachers() {
    return this.service.listTeachers();
  }

  @Roles(...ACADEMIC_READERS)
  @Get(':id')
  getTeacher(@Param('id') id: string) {
    return this.service.getTeacher(id);
  }

  @Post('import-csv')
  importCsv(@Body() body: CsvImportDto) {
    return this.service.importCsv(body.csv);
  }

  @Post('import-roster')
  importRoster(@Body() body: CsvImportDto) {
    return this.service.importTeacherRoster(body.csv);
  }
}

@Controller('academic/courses')
@Roles('ACADEMIC_SECRETARY')
export class AcademicCoursesController {
  constructor(private readonly service: AcademicService) {}

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
