import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppController } from '../app.controller';
import {
  AcademicController,
  AcademicCoursesController,
  AcademicSemestersController,
} from '../academic/academic.controller';
import { DashboardController } from '../dashboard/dashboard.controller';
import { JustificationsController } from '../justifications/justifications.controller';
import { StorageController } from '../storage/storage.controller';
import { UsersController } from '../users/users.controller';
import { AuthController } from './auth.controller';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { ROLES_KEY } from './decorators/roles.decorator';

type Access = 'PUBLIC' | 'AUTHENTICATED' | string[];

const controllers: Type[] = [
  AppController,
  AuthController,
  UsersController,
  AcademicController,
  AcademicCoursesController,
  AcademicSemestersController,
  DashboardController,
  JustificationsController,
  StorageController,
];

const reflector = new Reflector();

function accessFor(controller: Type, method: string): Access {
  const handler = controller.prototype[method] as () => unknown;
  const targets = [handler, controller];
  if (reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
    return 'PUBLIC';
  const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, targets);
  return roles && roles.length > 0 ? [...roles].sort() : 'AUTHENTICATED';
}

function routeMatrix(): Record<string, Access> {
  return Object.fromEntries(
    controllers.flatMap((controller) =>
      Object.getOwnPropertyNames(controller.prototype)
        .filter(
          (method) =>
            method !== 'constructor' &&
            typeof controller.prototype[method] === 'function',
        )
        .filter(
          (method) =>
            Reflect.getMetadata('method', controller.prototype[method]) !==
            undefined,
        )
        .map((method) => [
          `${controller.name}.${method}`,
          accessFor(controller, method),
        ]),
    ),
  );
}

const SECRETARY = ['ACADEMIC_SECRETARY'];
const COORDINATOR = ['TEACHING_SUPPORT_COORDINATOR'];
const ACADEMIC_READERS = [
  'ACADEMIC_PROCESS_ANALYST',
  'ACADEMIC_SECRETARY',
  'TEACHING_SUPPORT_COORDINATOR',
];

describe('Matriz de permisos por endpoint', () => {
  it('cada endpoint declara exactamente el acceso esperado', () => {
    expect(routeMatrix()).toEqual({
      'AppController.getHello': 'PUBLIC',

      'AuthController.googleAuth': 'PUBLIC',
      'AuthController.googleAuthRedirect': 'PUBLIC',
      'AuthController.getSession': 'PUBLIC',
      'AuthController.logout': 'PUBLIC',

      'UsersController.listPreloads': ['SYSTEM_ADMIN'],
      'UsersController.preload': ['SYSTEM_ADMIN'],
      'UsersController.cancelPreload': ['SYSTEM_ADMIN'],
      'UsersController.list': ['SYSTEM_ADMIN'],
      'UsersController.assign': ['SYSTEM_ADMIN'],
      'UsersController.revoke': ['SYSTEM_ADMIN'],
      'UsersController.setActive': ['SYSTEM_ADMIN'],
      'UsersController.permanentlyDelete': ['SYSTEM_ADMIN'],

      'AcademicController.listTeachers': ACADEMIC_READERS,
      'AcademicController.getTeacher': ACADEMIC_READERS,
      'AcademicController.importCsv': SECRETARY,
      'AcademicController.importRoster': SECRETARY,
      'AcademicCoursesController.listCourseSchedules': ACADEMIC_READERS,
      'AcademicCoursesController.importCourseSchedules': SECRETARY,
      'AcademicSemestersController.listSemesters': ACADEMIC_READERS,
      'AcademicSemestersController.activateSemester': SECRETARY,

      'DashboardController.systemAdmin': ['SYSTEM_ADMIN'],
      'DashboardController.academicSecretary': SECRETARY,
      'DashboardController.academicProcessAnalyst': [
        'ACADEMIC_PROCESS_ANALYST',
      ],
      'DashboardController.teachingSupportCoordinator': COORDINATOR,

      'JustificationsController.receiveFormSubmission': 'PUBLIC',
      'JustificationsController.listInbox': COORDINATOR,
      'JustificationsController.list': [
        'ACADEMIC_PROCESS_ANALYST',
        'ACADEMIC_SECRETARY',
        'TEACHING_SUPPORT_COORDINATOR',
      ],
      'JustificationsController.open': COORDINATOR,
      'JustificationsController.decide': COORDINATOR,
      'JustificationsController.evidenceUrl': [
        'ACADEMIC_SECRETARY',
        'TEACHING_SUPPORT_COORDINATOR',
      ],

      'StorageController.createPresignedUpload': 'AUTHENTICATED',
      'StorageController.createFormsPresignedUpload': 'PUBLIC',
    });
  });

  it('los endpoints públicos que reciben datos externos validan un secreto de webhook', () => {
    const source = (file: string) =>
      readFileSync(join(process.cwd(), 'src', file), 'utf8');

    expect(source('justifications/justifications.controller.ts')).toMatch(
      /@Public\(\)\s*@Post\('inbox'\)[\s\S]*?GOOGLE_FORMS_WEBHOOK_SECRET/,
    );
    expect(source('storage/storage.controller.ts')).toMatch(
      /@Public\(\)\s*@Post\('presigned-upload\/forms'\)[\s\S]*?GOOGLE_FORMS_WEBHOOK_SECRET/,
    );
  });
});

describe('Coherencia entre la matriz RBAC sembrada y los endpoints', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260906010000_seed_rbac_permission_matrix/migration.sql',
    ),
    'utf8',
  );
  const grants = [...migration.matchAll(/\('([A-Z_]+)', '([A-Z_]+)'\)/g)].map(
    ([, role, permission]) => ({
      role,
      permission,
    }),
  );
  const rolesWith = (permission: string) =>
    grants
      .filter((grant) => grant.permission === permission)
      .map(({ role }) => role);

  function rolesAllowed(route: string): string[] {
    const access = routeMatrix()[route];
    return Array.isArray(access) ? [...access, 'SYSTEM_ADMIN'] : [];
  }

  it.each([
    ['JUSTIFICATIONS_VIEW', 'JustificationsController.list'],
    ['JUSTIFICATIONS_CREATE', 'JustificationsController.listInbox'],
    ['JUSTIFICATIONS_CREATE', 'JustificationsController.open'],
    ['ACADEMIC_RECORDS_VIEW', 'AcademicController.listTeachers'],
    ['ACADEMIC_RECORDS_VIEW', 'AcademicCoursesController.listCourseSchedules'],
    ['ACADEMIC_RECORDS_VIEW', 'AcademicSemestersController.listSemesters'],
    ['ACADEMIC_RECORDS_MANAGE', 'AcademicController.importCsv'],
    ['USERS_MANAGE', 'UsersController.list'],
    ['ROLES_MANAGE', 'UsersController.assign'],
  ])('todo rol con %s puede usar %s', (permission, route) => {
    const allowed = rolesAllowed(route);

    expect(
      rolesWith(permission).filter((role) => !allowed.includes(role)),
    ).toEqual([]);
  });

  // Decisión de mínimo privilegio: JUSTIFICATIONS_VIEW permite consultar las
  // justificaciones, pero las evidencias (certificados médicos y otros
  // documentos personales) solo las ven quienes gestionan el proceso.
  it('las evidencias solo las descargan secretaría y coordinación', () => {
    expect(rolesAllowed('JustificationsController.evidenceUrl').sort()).toEqual(
      ['ACADEMIC_SECRETARY', 'SYSTEM_ADMIN', 'TEACHING_SUPPORT_COORDINATOR'],
    );
    expect(rolesWith('JUSTIFICATIONS_VIEW')).toContain(
      'ACADEMIC_PROCESS_ANALYST',
    );
  });
});
