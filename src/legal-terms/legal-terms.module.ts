import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TermsController } from './terms.controller';
import { TermsAcceptanceGuard } from './terms-acceptance.guard';
import { TermsService } from './terms.service';

@Module({
  imports: [PrismaModule],
  controllers: [TermsController],
  providers: [TermsService, TermsAcceptanceGuard],
  exports: [TermsService, TermsAcceptanceGuard],
})
export class LegalTermsModule {}
