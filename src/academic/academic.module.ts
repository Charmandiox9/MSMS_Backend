import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  AcademicController,
  AcademicCoursesController,
  AcademicSemestersController,
} from './academic.controller';
import { AcademicService } from './academic.service';
import { AcademicManagementService } from './academic-management.service';
import { AcademicManagementController } from './academic-management.controller';
import { AcademicReportsService } from './academic-reports.service';
import {
  AcademicReportsController,
  AcademicReportsGuard,
} from './academic-reports.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    AcademicManagementController,
    AcademicController,
    AcademicCoursesController,
    AcademicSemestersController,
    AcademicReportsController,
  ],
  providers: [
    AcademicService,
    AcademicManagementService,
    AcademicReportsService,
    AcademicReportsGuard,
  ],
})
export class AcademicModule {}
