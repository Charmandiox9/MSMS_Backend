import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SystemAuditController } from './system-audit.controller';
import { SystemAuditService } from './system-audit.service';

@Module({
  imports: [PrismaModule],
  controllers: [SystemAuditController],
  providers: [SystemAuditService],
})
export class SystemAuditModule {}
