import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AssistantshipsGuard } from './assistantships.guard';
import { AssistantshipsResolver } from './assistantships.resolver';
import { AssistantshipsService } from './assistantships.service';
import { SemesterBudgetsModule } from '../semester-budgets/semester-budgets.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AssistantshipApplicationsController } from './assistantship-applications.controller';
import { AssistantshipApplicationsService } from './assistantship-applications.service';

@Module({
  imports: [PrismaModule, SemesterBudgetsModule, NotificationsModule],
  controllers: [AssistantshipApplicationsController],
  providers: [
    AssistantshipsService,
    AssistantshipsGuard,
    AssistantshipsResolver,
    AssistantshipApplicationsService,
  ],
})
export class AssistantshipsModule {}
