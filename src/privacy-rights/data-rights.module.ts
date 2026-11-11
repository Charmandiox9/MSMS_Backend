import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DataRightsController } from './data-rights.controller';
import { DataRightsService } from './data-rights.service';

@Module({
  imports: [PrismaModule],
  controllers: [DataRightsController],
  providers: [DataRightsService],
})
export class DataRightsModule {}
