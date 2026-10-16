import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { StorageTransferController } from './storage-transfer.controller';

@Module({
  controllers: [StorageController, StorageTransferController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
