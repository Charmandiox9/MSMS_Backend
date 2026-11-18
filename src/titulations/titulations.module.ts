import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TitulationsController } from './titulations.controller';
import { TitulationsService } from './titulations.service';
import { LegacyAccessImportService } from './legacy-access-import.service';
import { TitulationDocumentsService } from './titulation-documents.service';

@Module({
  imports: [PrismaModule],
  controllers: [TitulationsController],
  providers: [
    TitulationsService,
    LegacyAccessImportService,
    TitulationDocumentsService,
  ],
  exports: [TitulationsService, LegacyAccessImportService],
})
export class TitulationsModule {}
