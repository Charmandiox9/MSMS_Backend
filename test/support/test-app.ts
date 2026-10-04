import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ValidationError } from 'class-validator';
import { AppModule } from '../../src/app.module';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StorageService } from '../../src/storage/storage.service';
import {
  createInMemoryPrisma,
  InMemoryPrisma,
  SeedUser,
} from './in-memory-prisma';

export const FORMS_SECRET = 'e2e-forms-secret';

export const USERS = {
  admin: { id: 'user-admin', email: 'admin@ucn.cl', roles: ['SYSTEM_ADMIN'] },
  secretary: {
    id: 'user-secretary',
    email: 'secretaria@ucn.cl',
    roles: ['ACADEMIC_SECRETARY'],
  },
  analyst: {
    id: 'user-analyst',
    email: 'analista@ucn.cl',
    roles: ['ACADEMIC_PROCESS_ANALYST'],
  },
  coordinator: {
    id: 'user-coordinator',
    email: 'coordinacion@ucn.cl',
    roles: ['TEACHING_SUPPORT_COORDINATOR'],
  },
  noRole: { id: 'user-no-role', email: 'sinrol@ucn.cl', roles: [] },
  inactive: {
    id: 'user-inactive',
    email: 'inactivo@ucn.cl',
    roles: ['SYSTEM_ADMIN'],
    isActive: false,
  },
} satisfies Record<string, SeedUser>;

export type UserKey = keyof typeof USERS;

function flattenValidationMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flattenValidationMessages(error.children ?? []),
  ]);
}

export interface TestApp {
  app: INestApplication;
  prisma: InMemoryPrisma;
  notifications: { send: jest.Mock };
  cookieFor(user: UserKey): string;
  close(): Promise<void>;
}

/**
 * Levanta AppModule con la misma configuración HTTP de main.ts (prefijo y
 * ValidationPipe; mantener sincronizado) y dependencias externas reemplazadas.
 */
export async function createTestApp(
  options: { storage?: StorageService } = {},
): Promise<TestApp> {
  const prisma = createInMemoryPrisma();
  Object.values(USERS).forEach((user) => prisma.seedUser(user));
  const notifications = { send: jest.fn().mockResolvedValue(undefined) };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(NotificationsService)
    .useValue(notifications)
    .overrideProvider(StorageService)
    .useValue(
      options.storage ?? {
        createPresignedUpload: jest.fn(),
        createPresignedDownload: jest.fn(),
      },
    )
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException(flattenValidationMessages(errors)),
    }),
  );
  await app.init();

  const jwt = new JwtService({ secret: process.env.JWT_SECRET });

  return {
    app,
    prisma,
    notifications,
    cookieFor: (user) =>
      `token=${jwt.sign({ sub: USERS[user].id }, { expiresIn: '1h' })}`,
    close: () => app.close(),
  };
}
