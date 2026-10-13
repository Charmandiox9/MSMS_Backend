import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { AcademicManagementService } from './academic-management.service';
import {
  CourseTeachersDto,
  CreateCourseDto,
  TeacherInputDto,
} from './academic-management.dto';

// REST keeps manual maintenance consistent with the existing academic endpoints.
@Controller('academic')
@Roles('ACADEMIC_SECRETARY')
export class AcademicManagementController {
  constructor(private readonly service: AcademicManagementService) {}

  @Get('courses/current')
  @Roles(
    'ACADEMIC_SECRETARY',
    'ACADEMIC_PROCESS_ANALYST',
    'TEACHING_SUPPORT_COORDINATOR',
  )
  currentCourses() {
    return this.service.currentCourses();
  }

  @Post('teachers')
  createTeacher(@Body() input: TeacherInputDto) {
    return this.service.createTeacher(input);
  }

  @Patch('teachers/:id')
  updateTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: TeacherInputDto,
  ) {
    return this.service.updateTeacher(id, input);
  }

  @Post('courses')
  createCourse(@Body() input: CreateCourseDto) {
    return this.service.createCourse(input);
  }

  @Put('courses/:nrc/teachers')
  setCourseTeachers(
    @Param('nrc') nrc: string,
    @Body() input: CourseTeachersDto,
  ) {
    return this.service.setCourseTeachers(nrc, input);
  }
}
