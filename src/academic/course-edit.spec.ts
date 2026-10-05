import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicCoursesController } from './academic.controller';
import { AcademicService } from './academic.service';
import { UpdateCourseDto } from './update-course.dto';

describe('Edición de asignaturas', () => {
  const prisma = {
    academicSemester: { findFirst: jest.fn() },
    course: { update: jest.fn() },
    teachingAssignment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    courseSchedule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((operation: (client: unknown) => Promise<unknown>) =>
      operation(prisma),
    ),
  };
  const service = new AcademicService(prisma as unknown as PrismaService);
  const input: UpdateCourseDto = {
    name: 'Nueva asignatura',
    code: 'ED',
    nrc: '20001',
    schedules: [
      { day: 'Lunes', block: 'A', location: 'Sala 1' },
      { day: 'Miércoles', block: 'B', location: 'Sala 2' },
    ],
  };
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.academicSemester.findFirst.mockResolvedValue({ id: 'semester' });
    prisma.courseSchedule.findMany.mockResolvedValue([{ courseId: 'course' }]);
    prisma.teachingAssignment.findMany.mockResolvedValue([
      { courseId: 'course' },
    ]);
    prisma.courseSchedule.findFirst.mockResolvedValue(null);
    prisma.teachingAssignment.findFirst.mockResolvedValue(null);
    prisma.course.update.mockResolvedValue({ id: 'course' });
  });
  it('actualiza salas independientes y el NRC sin reemplazar las asignaciones docentes', async () => {
    const controller = new AcademicCoursesController(service);
    await expect(controller.updateCourse('10001', input)).resolves.toEqual({
      courseId: 'course',
      nrc: '20001',
      updatedSchedules: 2,
    });
    expect(prisma.courseSchedule.createMany).toHaveBeenCalledWith({
      data: input.schedules.map((schedule) => ({
        ...schedule,
        semesterId: 'semester',
        courseId: 'course',
        nrc: '20001',
      })),
    });
    expect(prisma.teachingAssignment.updateMany).toHaveBeenCalledWith({
      where: { semesterId: 'semester', nrc: '10001', courseId: 'course' },
      data: { nrc: '20001' },
    });
    expect(prisma.courseSchedule.deleteMany).toHaveBeenCalledWith({
      where: { semesterId: 'semester', nrc: '10001', courseId: 'course' },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('rechaza horarios duplicados antes de escribir', async () => {
    await expect(
      service.updateCourse('10001', {
        ...input,
        schedules: [input.schedules[0], input.schedules[0]],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('permite quitar el código, guardando null sin copiar el NRC', async () => {
    const { code: _code, ...withoutCode } = input;
    expect(
      await validate(plainToInstance(UpdateCourseDto, withoutCode)),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpdateCourseDto, { ...input, code: null }),
      ),
    ).toHaveLength(0);
    await service.updateCourse('10001', { ...input, code: '' });
    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: 'course' },
      data: { name: input.name, code: null },
    });
  });
  it('rechaza un NRC ocupado sin eliminar horarios', async () => {
    prisma.courseSchedule.findFirst.mockResolvedValue({ id: 'other' });
    await expect(service.updateCourse('10001', input)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.courseSchedule.deleteMany).not.toHaveBeenCalled();
  });
  it('rechaza asignaturas ausentes y semestre inactivo', async () => {
    prisma.courseSchedule.findMany.mockResolvedValue([]);
    prisma.teachingAssignment.findMany.mockResolvedValue([]);
    await expect(service.updateCourse('10001', input)).rejects.toThrow(
      NotFoundException,
    );
    prisma.academicSemester.findFirst.mockResolvedValue(null);
    await expect(service.updateCourse('10001', input)).rejects.toThrow(
      BadRequestException,
    );
  });
  it('traduce conflictos de Prisma', async () => {
    prisma.course.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('private', {
        code: 'P2002',
        clientVersion: '7',
      }),
    );
    await expect(service.updateCourse('10001', input)).rejects.toThrow(
      ConflictException,
    );
  });
  it('valida salas, bloques, nombres y lista de horarios', async () => {
    expect(
      await validate(plainToInstance(UpdateCourseDto, input)),
    ).toHaveLength(0);
    for (const data of [
      { ...input, name: '   ' },
      { ...input, schedules: [] },
      { ...input, schedules: [{ day: 'Lunes', block: 'Z' }] },
      {
        ...input,
        schedules: [{ day: 'Lunes', block: 'A', location: 'x'.repeat(201) }],
      },
    ])
      expect(
        (await validate(plainToInstance(UpdateCourseDto, data))).length,
      ).toBeGreaterThan(0);
  });
  it.each([
    'SYSTEM_ADMIN',
    'ACADEMIC_SECRETARY',
    'ACADEMIC_PROCESS_ANALYST',
    'TEACHING_SUPPORT_COORDINATOR',
  ])('protege edición para %s', (role) => {
    const context = {
      getHandler: () => AcademicCoursesController.prototype.updateCourse,
      getClass: () => AcademicCoursesController,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ user: { roles: [role] } }) }),
    } as unknown as ExecutionContext;
    const guard = new RolesGuard(new Reflector());
    if (['SYSTEM_ADMIN', 'ACADEMIC_SECRETARY'].includes(role))
      expect(guard.canActivate(context)).toBe(true);
    else expect(() => guard.canActivate(context)).toThrow();
  });
  it('importa la sala por bloque y conserva salas al omitir la columna', async () => {
    prisma.teachingAssignment.findFirst.mockResolvedValue({
      courseId: 'course',
    });
    await service.importCourseSchedules(
      'nrc;asignatura;dia;bloque;sala\n10001;ED;Lunes;A;Sala 1\n10001;ED;Miércoles;B;Sala 2',
    );
    expect(
      prisma.courseSchedule.upsert.mock.calls.map(
        (call: [{ update: { location: string } }]) => call[0].update.location,
      ),
    ).toEqual(['Sala 1', 'Sala 2']);
    prisma.courseSchedule.upsert.mockClear();
    await service.importCourseSchedules(
      'nrc;asignatura;dia;bloque\n10001;ED;Lunes;A',
    );
    expect(prisma.courseSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { courseId: 'course' } }),
    );
  });
});
