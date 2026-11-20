import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  SemesterBudgetAlertsController,
  SemesterBudgetSettingsController,
} from './semester-budgets.controller';
import { SemesterBudgetsService } from './semester-budgets.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    SemesterBudgetSettingsController,
    SemesterBudgetAlertsController,
  ],
  providers: [SemesterBudgetsService],
  exports: [SemesterBudgetsService],
})
export class SemesterBudgetsModule {}
