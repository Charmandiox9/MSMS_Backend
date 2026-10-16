import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'node:path';
import { Request, Response } from 'express';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { createCacheOptions } from './cache/cache-options';
import { HealthModule } from './health/health.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppResolver } from './app.resolver';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { StorageModule } from './storage/storage.module';
import { JustificationsModule } from './justifications/justifications.module';
import { AcademicModule } from './academic/academic.module';
import { UsersModule } from './users/users.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AssistantshipsModule } from './assistantships/assistantships.module';
import { StudentsModule } from './students/students.module';
import { AcademicRepositoryModule } from './academic-repository/repository.module';
import { AcademicImportsModule } from './academic-imports/academic-imports.module';

const devProviders =
  process.env.NODE_ENV !== 'production'
    ? [{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }]
    : [];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      envFilePath: ['.env.pii', '.env.development', '.env'],
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile:
        process.env.NODE_ENV === 'production'
          ? true
          : join(process.cwd(), 'src/schema.gql'),
      path: '/api/graphql',
      context: ({ req, res }: { req: Request; res: Response }) => ({
        req,
        res,
      }),
    }),
    PrismaModule,
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createCacheOptions,
    }),
    AuthModule,
    StorageModule,
    JustificationsModule,
    AcademicModule,
    UsersModule,
    DashboardModule,
    AssistantshipsModule,
    StudentsModule,
    AcademicRepositoryModule,
    AcademicImportsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AppResolver,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    ...devProviders,
  ],
})
export class AppModule {}
