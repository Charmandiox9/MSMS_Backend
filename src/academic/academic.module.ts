import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  AcademicController,
  AcademicCoursesController,
  AcademicSemestersController,
} from './academic.controller';
import { AcademicService } from './academic.service';
import { AcademicReportsService } from './academic-reports.service';
import {
  AcademicReportsController,
  AcademicReportsGuard,
} from './academic-reports.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    AcademicController,
    AcademicCoursesController,
    AcademicSemestersController,
    AcademicReportsController,
  ],
  providers: [AcademicService, AcademicReportsService, AcademicReportsGuard],
})
export class AcademicModule {}
