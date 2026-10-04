import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';

function flattenValidationMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flattenValidationMessages(error.children ?? []),
  ]);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:80',
    'http://localhost',
    'https://msmsfrontend-production.up.railway.app',
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origen CORS no permitido'), false);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        return new BadRequestException(flattenValidationMessages(errors));
      },
    }),
  );

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
