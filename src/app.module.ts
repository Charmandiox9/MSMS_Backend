import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { Request, Response } from 'express';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
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

const devProviders =
  process.env.NODE_ENV !== 'production'
    ? [{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }]
    : [];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.development', '.env'],
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
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
      useFactory: async (configService: ConfigService) => {
        const isProduction =
          configService.get<string>('NODE_ENV') === 'production';
        const cacheType = configService.get<string>('CACHE_TYPE');
        const redisUrl = configService.get<string>('REDIS_URL');

        if (isProduction && !redisUrl) {
          throw new Error(
            'REDIS_URL es obligatoria cuando NODE_ENV=production',
          );
        }

        if (isProduction || cacheType === 'redis') {
          return {
            store: await redisStore({
              url: redisUrl ?? 'redis://localhost:6379',
            }),
            ttl: 60 * 1000,
          };
        }
        return {
          ttl: 60 * 1000,
        };
      },
    }),
    AuthModule,
    StorageModule,
    JustificationsModule,
    AcademicModule,
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
