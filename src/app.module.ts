import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppResolver } from './app.resolver';
import { PrismaModule } from './prisma/prisma.module';

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
    }),
    PrismaModule,
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const cacheType = configService.get<string>('CACHE_TYPE');
        if (cacheType === 'redis') {
          return {
            store: await redisStore({
              url: configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
            }),
            ttl: 60 * 1000,
          };
        }
        return {
          ttl: 60 * 1000,
        };
      },
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AppResolver,
    ...devProviders,
  ],
})
export class AppModule {}
