import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CareersController } from './careers.controller';
import { CareersService } from './careers.service';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';

@Module({
  imports: [PrismaModule],
  controllers: [CareersController, DepartmentsController],
  providers: [CareersService, DepartmentsService],
  exports: [CareersService],
})
export class CareersModule {}
