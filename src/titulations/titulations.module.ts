import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TitulationsController } from './titulations.controller';
import { TitulationsService } from './titulations.service';
import { LegacyAccessImportService } from './legacy-access-import.service';
import { TitulationDocumentsService } from './titulation-documents.service';
import { StorageModule } from '../storage/storage.module';
import { TitulationAttachmentsService } from './titulation-attachments.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [TitulationsController],
  providers: [
    TitulationsService,
    LegacyAccessImportService,
    TitulationDocumentsService,
    TitulationAttachmentsService,
  ],
  exports: [TitulationsService, LegacyAccessImportService],
})
export class TitulationsModule {}
