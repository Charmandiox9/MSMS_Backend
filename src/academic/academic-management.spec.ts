import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicManagementController } from './academic-management.controller';
import { AcademicManagementService } from './academic-management.service';
import { HourlyPaymentsService } from './hourly-payments.service';
import {
  CourseTeachersDto,
  CreateCourseDto,
  TeacherInputDto,
} from './academic-management.dto';

const semesterId = '11111111-1111-4111-8111-111111111111';
const teacherId = '22222222-2222-4222-8222-222222222222';
const course = { id: 'course', name: 'Biología marina', code: 'BM' };
const profile: TeacherInputDto = {
  name: 'Ana Soto',
  email: 'ana@example.com',
  employeeCode: null,
};
const courseInput: CreateCourseDto = {
  name: course.name,
  code: course.code,
  nrc: '10001',
  semesterId,
  schedules: [{ day: 'Lunes', block: 'A', location: 'Sala 1' }],
};

describe('Gestión individual de docentes y asignaturas', () => {
  const prisma = {
    academicSemester: { findFirst: jest.fn() },
    teacher: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
    },
    course: { findFirst: jest.fn(), create: jest.fn() },
    courseSchedule: { findMany: jest.fn(), createMany: jest.fn() },
    teachingAssignment: {
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    studentEnrollment: { findMany: jest.fn() },
    assistantship: { count: jest.fn() },
    hourlyTeachingContract: { count: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: AcademicManagementService;
  let hourlyPayments: { sync: jest.Mock; removeOmitted: jest.Mock };
  let controller: AcademicManagementController;
  beforeAll(async () => {
    hourlyPayments = { sync: jest.fn(), removeOmitted: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AcademicManagementService,
        {
          provide: HourlyPaymentsService,
          useValue: hourlyPayments,
        },
        { provide: PrismaService, useValue: prisma },
      ],
      controllers: [AcademicManagementController],
    }).compile();
    service = module.get(AcademicManagementService);
    controller = module.get(AcademicManagementController);
  });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        operation(prisma as unknown as Prisma.TransactionClient),
    );
    prisma.academicSemester.findFirst.mockResolvedValue({
      id: semesterId,
      name: '2026-2',
    });
    prisma.teacher.create.mockResolvedValue({ id: teacherId, ...profile });
    prisma.teacher.findUnique.mockResolvedValue({ id: teacherId, ...profile });
    prisma.teacher.findFirst.mockResolvedValue({
      id: teacherId,
      rut: '12345678-5',
    });
    prisma.teacher.findUniqueOrThrow.mockResolvedValue({
      id: teacherId,
      ...profile,
      assignments: [],
    });
    prisma.teacher.findMany.mockResolvedValue([{ id: teacherId }]);
    prisma.courseSchedule.findMany.mockResolvedValue([
      { nrc: '10001', course },
    ]);
    prisma.teachingAssignment.findMany.mockResolvedValue([]);
    prisma.studentEnrollment.findMany.mockResolvedValue([]);
    prisma.assistantship.count.mockResolvedValue(0);
    prisma.hourlyTeachingContract.count.mockResolvedValue(0);
    prisma.course.findFirst.mockResolvedValue(null);
    prisma.course.create.mockResolvedValue(course);
  });

  it('consulta solo las ofertas del semestre activo y agrupa horarios por NRC', async () => {
    prisma.courseSchedule.findMany.mockResolvedValue([
      { nrc: '10001', course },
      { nrc: '10001', course },
    ]);
    prisma.teachingAssignment.findMany.mockResolvedValue([
      {
        nrc: '10001',
        course,
        teacher: { id: teacherId, name: profile.name, email: profile.email },
      },
    ]);
    const result = await controller.currentCourses();
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].teachers[0].id).toBe(teacherId);
    expect(prisma.courseSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { semesterId } }),
    );
    expect(prisma.teachingAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { semesterId } }),
    );
  });
  it('devuelve el estado sin semestre activo y permite crear solo el perfil', async () => {
    prisma.academicSemester.findFirst.mockResolvedValue(null);
    expect(await service.currentCourses()).toEqual({
      semester: null,
      courses: [],
    });
    await controller.createTeacher(profile);
    expect(prisma.teachingAssignment.create).not.toHaveBeenCalled();
  });
  it('crea un profesor y vincula su asignatura en la misma transacción', async () => {
    await controller.createTeacher({
      ...profile,
      email: ' ANA@example.com ',
      semesterId,
      nrcs: ['10001'],
    });
    expect(prisma.teacher.create).toHaveBeenCalledWith({
      data: { ...profile, email: 'ana@example.com' },
    });
    expect(prisma.teachingAssignment.create).toHaveBeenCalledWith({
      data: { teacherId, semesterId, courseId: course.id, nrc: '10001' },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('edita el perfil, conserva los vínculos elegidos y elimina solo el vínculo del semestre activo', async () => {
    const assignment = {
      id: 'assignment',
      teacherId,
      semesterId,
      courseId: course.id,
      nrc: '10001',
      course,
      teacher: { id: teacherId, ...profile },
    };
    prisma.teachingAssignment.findMany.mockResolvedValue([assignment]);
    await controller.updateTeacher(teacherId, {
      ...profile,
      semesterId,
      nrcs: ['10001'],
    });
    expect(prisma.teacher.update).toHaveBeenCalledWith({
      where: { id: teacherId },
      data: profile,
    });
    expect(prisma.teachingAssignment.create).not.toHaveBeenCalled();
    expect(prisma.teachingAssignment.deleteMany).not.toHaveBeenCalled();
    await service.updateTeacher(teacherId, {
      ...profile,
      semesterId,
      nrcs: [],
    });
    expect(prisma.teachingAssignment.findMany).toHaveBeenCalledWith({
      where: { teacherId, semesterId },
    });
    expect(prisma.teachingAssignment.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['assignment'] } },
    });
  });
  it('rechaza vínculos a NRC de otros semestres, semestre cambiado y datos incompletos', async () => {
    await expect(
      service.updateTeacher(teacherId, {
        ...profile,
        semesterId,
        nrcs: ['old'],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateTeacher(teacherId, {
        ...profile,
        semesterId: teacherId,
        nrcs: [],
      }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.updateTeacher(teacherId, { ...profile, nrcs: [] }),
    ).rejects.toThrow(BadRequestException);
    prisma.academicSemester.findFirst.mockResolvedValue(null);
    await expect(
      service.updateTeacher(teacherId, { ...profile, semesterId, nrcs: [] }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.teachingAssignment.create).not.toHaveBeenCalled();
    expect(prisma.teachingAssignment.deleteMany).not.toHaveBeenCalled();
  });
  it('rechaza editar un docente inexistente', async () => {
    prisma.teacher.findUnique.mockResolvedValue(null);
    await expect(service.updateTeacher(teacherId, profile)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.teacher.update).not.toHaveBeenCalled();
  });
  it('normaliza y valida el RUT y conserva los campos omitidos en una edición', async () => {
    await service.createTeacher({
      ...profile,
      rut: '12.345.678-5',
      academicDegree: 'MASTER',
      certification: 'LEVEL_1',
      academicUnit: 'EPRYMA',
    });
    expect(prisma.teacher.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rut: '12345678-5',
        academicDegree: 'MASTER',
        certification: 'LEVEL_1',
      }),
    });
    await expect(
      service.createTeacher({ ...profile, rut: '12345678-0' }),
    ).rejects.toThrow(BadRequestException);
    await service.updateTeacher(teacherId, profile);
    expect(prisma.teacher.update).toHaveBeenLastCalledWith({
      where: { id: teacherId },
      data: profile,
    });
  });
  it('rechaza una fecha de salida anterior al ingreso guardado', async () => {
    prisma.teacher.findUnique.mockResolvedValue({
      id: teacherId,
      ...profile,
      joinedOn: new Date('2026-08-01'),
      leftOn: null,
    });
    await expect(
      service.updateTeacher(teacherId, { ...profile, leftOn: '2026-07-31' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.teacher.update).not.toHaveBeenCalled();
  });
  it('guarda perfil, asignaturas y contratos PH en la misma transacción', async () => {
    const contracts = [
      {
        nrc: '10001',
        payRateId: '33333333-3333-4333-8333-333333333333',
        component: 'LABORATORY' as const,
        parallel: 'L3',
        directHours: 3,
        startsOn: '2026-08-17',
        endsOn: '2026-12-19',
      },
    ];
    await service.createTeacher({
      ...profile,
      rut: '12345678-5',
      semesterId,
      nrcs: ['10001'],
      hourlyContracts: contracts,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(hourlyPayments.sync).toHaveBeenCalledWith(
      prisma,
      teacherId,
      semesterId,
      contracts,
    );
    prisma.teacher.findFirst.mockResolvedValue(null);
    await expect(
      service.updateTeacher(teacherId, {
        ...profile,
        semesterId,
        nrcs: ['10001'],
        hourlyContracts: contracts,
      }),
    ).rejects.toThrow(BadRequestException);
  });
  it('protege las asignaturas con contratos PH cuando no se solicita retirarlos', async () => {
    prisma.teachingAssignment.findMany.mockResolvedValue([
      {
        id: 'assignment',
        teacherId,
        courseId: course.id,
        course,
        teacher: { id: teacherId, ...profile },
        nrc: '10001',
      },
    ]);
    prisma.hourlyTeachingContract.count.mockResolvedValue(1);
    await expect(
      service.updateTeacher(teacherId, { ...profile, semesterId, nrcs: [] }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.teachingAssignment.deleteMany).not.toHaveBeenCalled();
    expect(hourlyPayments.removeOmitted).not.toHaveBeenCalled();
  });
  it('crea NRC y horarios y reutiliza el registro del catálogo sin modificar el pasado', async () => {
    prisma.courseSchedule.findMany.mockResolvedValue([]);
    await expect(controller.createCourse(courseInput)).resolves.toEqual({
      courseId: course.id,
      nrc: '10001',
    });
    expect(prisma.courseSchedule.createMany).toHaveBeenCalledWith({
      data: [
        {
          semesterId,
          courseId: course.id,
          nrc: '10001',
          day: 'Lunes',
          block: 'A',
          location: 'Sala 1',
        },
      ],
    });
    prisma.course.create.mockClear();
    prisma.course.findFirst.mockResolvedValue(course);
    await service.createCourse({ ...courseInput, nrc: '10002' });
    expect(prisma.course.create).not.toHaveBeenCalled();
  });
  it('rechaza NRC repetidos y horarios duplicados', async () => {
    await expect(service.createCourse(courseInput)).rejects.toThrow(
      ConflictException,
    );
    await expect(
      service.createCourse({
        ...courseInput,
        schedules: [courseInput.schedules[0], courseInput.schedules[0]],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.courseSchedule.createMany).not.toHaveBeenCalled();
  });
  it('crear una asignatura exige el semestre activo y nunca crea registros en otro semestre', async () => {
    await expect(
      service.createCourse({ ...courseInput, semesterId: teacherId }),
    ).rejects.toThrow(ConflictException);
    prisma.academicSemester.findFirst.mockResolvedValue(null);
    await expect(service.createCourse(courseInput)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.course.create).not.toHaveBeenCalled();
    expect(prisma.courseSchedule.createMany).not.toHaveBeenCalled();
  });
  it('crea y edita el perfil de un profesor sin consultar ni depender de un semestre', async () => {
    prisma.academicSemester.findFirst.mockResolvedValue(null);
    await service.createTeacher(profile);
    await service.updateTeacher(teacherId, { ...profile, name: 'Ana Pérez' });
    expect(prisma.teacher.create).toHaveBeenCalledWith({ data: profile });
    expect(prisma.teacher.update).toHaveBeenCalledWith({
      where: { id: teacherId },
      data: { ...profile, name: 'Ana Pérez' },
    });
    expect(prisma.academicSemester.findFirst).not.toHaveBeenCalled();
    expect(prisma.teachingAssignment.create).not.toHaveBeenCalled();
    expect(prisma.teachingAssignment.deleteMany).not.toHaveBeenCalled();
  });
  it('vincula y desvincula desde una asignatura del semestre activo', async () => {
    await controller.setCourseTeachers('10001', {
      semesterId,
      teacherIds: [teacherId],
    });
    expect(prisma.teachingAssignment.create).toHaveBeenCalledWith({
      data: { semesterId, teacherId, courseId: course.id, nrc: '10001' },
    });
    prisma.teachingAssignment.findMany.mockResolvedValue([
      {
        id: 'assignment',
        teacherId,
        semesterId,
        courseId: course.id,
        nrc: '10001',
        course,
        teacher: { id: teacherId, ...profile },
      },
    ]);
    prisma.teacher.findMany.mockResolvedValue([]);
    await service.setCourseTeachers('10001', { semesterId, teacherIds: [] });
    expect(prisma.teachingAssignment.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['assignment'] } },
    });
  });
  it('no elimina vínculos con ayudantías asociadas desde ninguna vista', async () => {
    prisma.teachingAssignment.findMany.mockResolvedValue([
      {
        id: 'assignment',
        teacherId,
        semesterId,
        courseId: course.id,
        nrc: '10001',
        course,
        teacher: { id: teacherId, ...profile },
      },
    ]);
    prisma.assistantship.count.mockResolvedValue(1);
    prisma.teacher.findMany.mockResolvedValue([]);
    await expect(
      service.setCourseTeachers('10001', { semesterId, teacherIds: [] }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.updateTeacher(teacherId, { ...profile, semesterId, nrcs: [] }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.teachingAssignment.deleteMany).not.toHaveBeenCalled();
  });
  it('rechaza profesores inexistentes y asignaturas que no son del semestre activo', async () => {
    prisma.teacher.findMany.mockResolvedValue([]);
    await expect(
      service.setCourseTeachers('10001', {
        semesterId,
        teacherIds: [teacherId],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.setCourseTeachers('old', { semesterId, teacherIds: [] }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.teachingAssignment.create).not.toHaveBeenCalled();
  });
  it.each(['P2002', 'P2003', 'P2034'])(
    'traduce el conflicto Prisma %s sin revelar el error crudo',
    async (code) => {
      prisma.teacher.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('private database details', {
          code,
          clientVersion: '7',
        }),
      );
      await expect(service.createTeacher(profile)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.createTeacher(profile)).rejects.not.toThrow(
        'private database details',
      );
    },
  );

  it('valida perfiles, UUID, NRC y horarios en los DTO', async () => {
    expect(
      await validate(
        plainToInstance(TeacherInputDto, {
          ...profile,
          semesterId,
          nrcs: ['10001'],
        }),
      ),
    ).toHaveLength(0);
    for (const input of [
      { ...profile, email: 'invalid' },
      { ...profile, name: ' ' },
      { ...profile, nrcs: null },
      { ...profile, semesterId: null },
      { ...profile, nrcs: ['10001', '10001'] },
    ])
      expect(
        (await validate(plainToInstance(TeacherInputDto, input))).length,
      ).toBeGreaterThan(0);
    expect(
      await validate(plainToInstance(CreateCourseDto, courseInput)),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(CreateCourseDto, { ...courseInput, schedules: [] }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(CourseTeachersDto, {
            semesterId,
            teacherIds: ['invalid'],
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it.each([
    'createTeacher',
    'updateTeacher',
    'createCourse',
    'setCourseTeachers',
  ] as const)('protege %s para administración y secretaría', (method) => {
    const guard = new RolesGuard(new Reflector());
    for (const role of [
      'SYSTEM_ADMIN',
      'ACADEMIC_SECRETARY',
      'ACADEMIC_PROCESS_ANALYST',
      'TEACHING_SUPPORT_COORDINATOR',
    ]) {
      const context = {
        getHandler: () => AcademicManagementController.prototype[method],
        getClass: () => AcademicManagementController,
        getType: () => 'http',
        switchToHttp: () => ({
          getRequest: () => ({ user: { roles: [role] } }),
        }),
      } as unknown as ExecutionContext;
      if (['SYSTEM_ADMIN', 'ACADEMIC_SECRETARY'].includes(role))
        expect(guard.canActivate(context)).toBe(true);
      else expect(() => guard.canActivate(context)).toThrow();
    }
  });
});
