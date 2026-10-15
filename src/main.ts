import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { json, urlencoded } from 'express';

// Las importaciones envían el CSV completo como texto dentro del JSON. Solo esas
// rutas aceptan cuerpos grandes; el resto mantiene el límite por defecto (100 KB)
// porque el cuerpo se lee antes de validar la sesión.
const CSV_IMPORT_ROUTES = [
  '/api/academic/teachers/import-csv',
  '/api/academic/teachers/import-roster',
  '/api/academic/courses/import-csv',
];
const EXCEL_IMPORT_ROUTES = [
  '/api/academic/imports/projects/preview',
  '/api/academic/imports/projects/commit',
  '/api/academic/imports/research/preview',
  '/api/academic/imports/research/commit',
  '/api/academic/imports/hourly/preview',
  '/api/academic/imports/hourly/commit',
];
const CSV_IMPORT_BODY_LIMIT = '100mb';

function flattenValidationMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flattenValidationMessages(error.children ?? []),
  ]);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.setGlobalPrefix('api');
  app.use(CSV_IMPORT_ROUTES, json({ limit: CSV_IMPORT_BODY_LIMIT }));
  app.use(EXCEL_IMPORT_ROUTES, json({ limit: '18mb' }));
  app.use('/api/academic/students/import-csv', json({ limit: '8mb' }));
  app.use(json());
  app.use(urlencoded({ extended: true }));

  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:80',
    'http://localhost',
    'https://msmsfrontend-production.up.railway.app',
  ];

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
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
void bootstrap();
