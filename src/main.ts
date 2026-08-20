import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GqlExceptionFilter } from './common/filters/gql-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:80',
    'http://localhost',
  ];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        console.log(errors);
        return new BadRequestException(errors);
      },
    }),
  );

  app.useGlobalFilters(new GqlExceptionFilter());

  await app.listen(process.env.PORT ?? 3001);

  const environment = process.env.NODE_ENV;
  const host =
    environment === 'production' && process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL
      : `http://localhost:${process.env.PORT}`;

  console.log(`🌍 Entorno: ${environment}`);
  console.log(`🚀 API: ${host}/api`);
  console.log(`📊 GraphQL: ${host}/api/graphql`);
}
bootstrap();
