import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AcademicImportsController } from './academic-imports.controller';
import { AcademicImportsService } from './academic-imports.service';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicImportsController],
  providers: [AcademicImportsService],
})
export class AcademicImportsModule {}
