import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrivacyModule } from '../privacy/privacy.module';

@Module({
  imports: [PrivacyModule],
  providers: [PrismaService],
  exports: [PrismaService, PrivacyModule],
})
export class PrismaModule {}
