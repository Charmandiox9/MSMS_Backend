import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AssistantshipsGuard } from './assistantships.guard';
import { AssistantshipsResolver } from './assistantships.resolver';
import { AssistantshipsService } from './assistantships.service';
import { SemesterBudgetsModule } from '../semester-budgets/semester-budgets.module';

@Module({
  imports: [PrismaModule, SemesterBudgetsModule],
  providers: [
    AssistantshipsService,
    AssistantshipsGuard,
    AssistantshipsResolver,
  ],
})
export class AssistantshipsModule {}
