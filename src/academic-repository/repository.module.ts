import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  ProjectsController,
  ResearchController,
  ResearchOutputsController,
} from './repository.controller';
import { RepositoryService } from './repository.service';
@Module({
  imports: [PrismaModule],
  controllers: [ProjectsController, ResearchController, ResearchOutputsController],
  providers: [RepositoryService],
})
export class AcademicRepositoryModule {}
