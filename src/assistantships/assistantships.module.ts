import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AssistantshipsGuard } from './assistantships.guard';
import { AssistantshipsResolver } from './assistantships.resolver';
import { AssistantshipsService } from './assistantships.service';

@Module({
  imports: [PrismaModule],
  providers: [
    AssistantshipsService,
    AssistantshipsGuard,
    AssistantshipsResolver,
  ],
})
export class AssistantshipsModule {}
