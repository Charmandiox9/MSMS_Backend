import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TitulationsModule } from './titulations.module';
import {
  developmentEnvironmentFile,
  ignoreDevelopmentEnvironmentFile,
} from '../config/development-environment';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: ignoreDevelopmentEnvironmentFile(),
      envFilePath: developmentEnvironmentFile,
    }),
    TitulationsModule,
  ],
})
export class LegacyAccessImportModule {}
