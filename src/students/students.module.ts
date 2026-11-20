import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { StudentIdentityService } from './student-identity.service';

@Module({
  imports: [PrismaModule],
  controllers: [StudentsController],
  providers: [StudentsService, StudentIdentityService],
  exports: [StudentIdentityService],
})
export class StudentsModule {}
