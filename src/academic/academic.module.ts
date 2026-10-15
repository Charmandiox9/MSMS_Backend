import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  AcademicController,
  AcademicCoursesController,
  AcademicSemestersController,
} from './academic.controller';
import { AcademicService } from './academic.service';
import { HourlyPaymentsController } from './hourly-payments.controller';
import { HourlyPaymentsService } from './hourly-payments.service';
import { AcademicManagementService } from './academic-management.service';
import { AcademicManagementController } from './academic-management.controller';
import { AcademicReportsService } from './academic-reports.service';
import { AcademicReportsResolver } from './academic-reports.resolver';
import { AcademicChartsService } from './academic-charts.service';
import {
  AcademicReportsController,
  AcademicReportsGuard,
} from './academic-reports.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    HourlyPaymentsController,
    AcademicManagementController,
    AcademicController,
    AcademicCoursesController,
    AcademicSemestersController,
    AcademicReportsController,
  ],
  providers: [
    HourlyPaymentsService,
    AcademicService,
    AcademicManagementService,
    AcademicReportsService,
    AcademicReportsGuard,
    AcademicReportsResolver,
    AcademicChartsService,
  ],
})
export class AcademicModule {}
