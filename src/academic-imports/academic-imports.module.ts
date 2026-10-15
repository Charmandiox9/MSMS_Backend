import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AcademicImportsController } from './academic-imports.controller';
import { AcademicImportQueueService } from './academic-import-queue.service';
import { AcademicImportsService } from './academic-imports.service';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicImportsController],
  providers: [AcademicImportsService, AcademicImportQueueService],
})
export class AcademicImportsModule {}
