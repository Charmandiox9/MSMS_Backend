import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TitulationsModule } from './titulations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env.pii', '.env.development', '.env'],
    }),
    TitulationsModule,
  ],
})
export class LegacyAccessImportModule {}
