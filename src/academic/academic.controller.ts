import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AcademicService } from './academic.service';

class CsvImportDto {
  @IsString()
  @IsNotEmpty()
  csv!: string;
}

@Controller('academic/teachers')
@Roles('ACADEMIC_SECRETARY')
export class AcademicController {
  constructor(private readonly service: AcademicService) {}

  @Get()
  listTeachers() {
    return this.service.listTeachers();
  }

  @Get(':id')
  getTeacher(@Param('id') id: string) {
    return this.service.getTeacher(id);
  }

  @Post('import-csv')
  importCsv(@Body() body: CsvImportDto) {
    return this.service.importCsv(body.csv);
  }
}
