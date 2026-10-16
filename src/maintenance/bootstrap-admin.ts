import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { WhitelistService } from '../auth/whitelist/whitelist.service';
import { InitialAdminService } from './initial-admin.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      envFilePath: ['.env.pii', '.env.development', '.env'],
    }),
    PrismaModule,
  ],
  providers: [WhitelistService, InitialAdminService],
})
class InitialAdminModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(InitialAdminModule, {
    logger: false,
  });
  try {
    const email =
      app.get(ConfigService).get<string>('BOOTSTRAP_ADMIN_EMAIL') ?? '';
    const result = await app.get(InitialAdminService).prepare(email);
    console.log(
      `Administrador inicial: ${result.status}. No se ha creado una sesión de acceso.`,
    );
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  console.error(
    'No se pudo preparar el administrador inicial. Revisa migraciones, whitelist y precargas.',
  );
  process.exitCode = 1;
});
