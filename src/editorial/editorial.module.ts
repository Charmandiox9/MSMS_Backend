import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { EditorialAccessGuard } from './editorial-access.guard';
import { EditorialFilesController } from './editorial-files.controller';
import { EditorialFilesService } from './editorial-files.service';
import {
  EditorialResolver,
  EditorialRevisionResolver,
} from './editorial.resolver';
import { EditorialService } from './editorial.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [EditorialFilesController],
  providers: [
    EditorialAccessGuard,
    EditorialFilesService,
    EditorialResolver,
    EditorialRevisionResolver,
    EditorialService,
  ],
})
export class EditorialModule {}
