import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { JustificationsController } from './justifications.controller';
import { JustificationsService } from './justifications.service';

@Module({
  imports: [NotificationsModule, StorageModule, PrismaModule],
  controllers: [JustificationsController],
  providers: [JustificationsService],
})
export class JustificationsModule {}
