import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AcademicController, AcademicCoursesController, AcademicSemestersController } from './academic.controller';
import { AcademicService } from './academic.service';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicController, AcademicCoursesController, AcademicSemestersController],
  providers: [AcademicService],
})
export class AcademicModule {}
