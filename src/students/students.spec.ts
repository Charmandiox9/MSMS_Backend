import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import {
  ImportStudentsDto,
  ListStudentsDto,
  StudentInputDto,
} from './students.dto';

const semesterId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const profile = { name: 'Ana Soto', email: 'ana@example.com' };
const course = { id: 'course', name: 'Biología marina', code: 'BM' };

describe('Módulo de estudiantes', () => {
  const prisma = {
    academicSemester: { findFirst: jest.fn() },
    courseSchedule: { findMany: jest.fn() },
    teachingAssignment: { findMany: jest.fn() },
    student: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    studentEnrollment: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  let service: StudentsService;
  let controller: StudentsController;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StudentsController],
      providers: [
        StudentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(StudentsService);
    controller = module.get(StudentsController);
  });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (
        operation:
          | ((tx: Prisma.TransactionClient) => Promise<unknown>)
          | Promise<unknown>[],
      ) =>
        Array.isArray(operation)
          ? Promise.all(operation)
          : operation(prisma as unknown as Prisma.TransactionClient),
    );
    prisma.academicSemester.findFirst.mockResolvedValue({
      id: semesterId,
      name: '2026-2',
    });
    prisma.courseSchedule.findMany.mockResolvedValue([
      { nrc: '10001', course },
    ]);
    prisma.teachingAssignment.findMany.mockResolvedValue([]);
    prisma.studentEnrollment.findMany.mockResolvedValue([]);
    prisma.studentEnrollment.createMany.mockResolvedValue({ count: 1 });
    prisma.student.create.mockResolvedValue({ id: studentId, ...profile });
    prisma.student.update.mockResolvedValue({ id: studentId, ...profile });
    prisma.student.findUnique.mockResolvedValue({
      id: studentId,
      ...profile,
      enrollments: [],
    });
    prisma.student.findUniqueOrThrow.mockResolvedValue({
      id: studentId,
      ...profile,
      enrollments: [],
    });
    prisma.student.findMany.mockResolvedValue([
      { id: studentId, ...profile, enrollments: [] },
    ]);
    prisma.student.count.mockResolvedValue(1);
  });
  it('crea un estudiante global y vincula la asignatura sin depender de un profesor', async () => {
    await controller.create({
      ...profile,
      email: ' ANA@example.com ',
      semesterId,
      nrcs: ['10001'],
    });
    expect(prisma.student.create).toHaveBeenCalledWith({ data: profile });
    expect(prisma.studentEnrollment.createMany).toHaveBeenCalledWith({
      data: [{ studentId, semesterId, courseId: 'course', nrc: '10001' }],
      skipDuplicates: true,
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });
  it('sin semestre activo permite crear un perfil sin matrículas', async () => {
    prisma.academicSemester.findFirst.mockResolvedValue(null);
    await service.save(profile);
    expect(prisma.academicSemester.findFirst).not.toHaveBeenCalled();
    expect(prisma.studentEnrollment.createMany).not.toHaveBeenCalled();
  });
  it('edita datos y desvincula solo las matrículas del semestre activo', async () => {
    await controller.update(studentId, { ...profile, semesterId, nrcs: [] });
    expect(prisma.student.update).toHaveBeenCalledWith({
      where: { id: studentId },
      data: profile,
    });
    expect(prisma.studentEnrollment.deleteMany).toHaveBeenCalledWith({
      where: { studentId, semesterId, nrc: { notIn: [] } },
    });
  });
  it('no escribe perfiles ni matrículas cuando hay NRC inexistentes o cambia el semestre', async () => {
    await expect(
      service.save({ ...profile, semesterId, nrcs: ['old'] }),
    ).rejects.toThrow('NRC old no existe');
    await expect(
      service.save({ ...profile, semesterId: studentId, nrcs: ['10001'] }),
    ).rejects.toThrow(ConflictException);
    await expect(service.save({ ...profile, nrcs: ['10001'] })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.student.create).not.toHaveBeenCalled();
    expect(prisma.studentEnrollment.createMany).not.toHaveBeenCalled();
  });
  it('rechaza actualizar o consultar estudiantes que no existen', async () => {
    prisma.student.findUnique.mockResolvedValue(null);
    await expect(service.save(profile, studentId)).rejects.toThrow(
      NotFoundException,
    );
    await expect(controller.get(studentId)).rejects.toThrow(NotFoundException);
  });
  it('consulta globalmente, pagina y filtra el NRC del semestre activo', async () => {
    const result = await controller.list({
      page: 2,
      pageSize: 10,
      nrc: '10001',
      search: 'Ana',
    });
    expect(result.total).toBe(1);
    expect(prisma.student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        where: expect.objectContaining({
          enrollments: { some: { nrc: '10001', semester: { isActive: true } } },
        }),
      }),
    );
    prisma.student.findMany.mockClear();
    await service.list({ page: 1, pageSize: 10 });
    expect(prisma.student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
  it('valida todos los NRC del CSV antes de crear estudiantes: una fila errónea rechaza todo', async () => {
    await expect(
      service.importCsv({
        semesterId,
        csv: 'nombre;correo;nrc\nAna;ana@example.com;10001\nPedro;pedro@example.com;99999',
      }),
    ).rejects.toThrow('Fila 3: el NRC 99999');
    expect(prisma.student.createMany).not.toHaveBeenCalled();
    expect(prisma.studentEnrollment.createMany).not.toHaveBeenCalled();
  });
  it('reimportar reutiliza el estudiante y añade vínculos sin borrar los anteriores', async () => {
    const result = await controller.importCsv({
      semesterId,
      csv: 'nombre;correo;nrc\nAna Soto;ana@example.com;10001',
    });
    expect(result).toMatchObject({
      importedStudents: 1,
      createdStudents: 0,
      addedEnrollments: 1,
    });
    expect(prisma.student.createMany).toHaveBeenCalledWith({
      data: [profile],
      skipDuplicates: true,
    });
    expect(prisma.studentEnrollment.createMany).toHaveBeenCalledWith({
      data: [{ studentId, semesterId, courseId: 'course', nrc: '10001' }],
      skipDuplicates: true,
    });
    expect(prisma.student.update).not.toHaveBeenCalled();
    expect(prisma.studentEnrollment.deleteMany).not.toHaveBeenCalled();
    prisma.studentEnrollment.createMany.mockResolvedValue({ count: 0 });
    expect(
      (
        await service.importCsv({
          semesterId,
          csv: 'nombre;correo;nrc\nAna Soto;ana@example.com;10001',
        })
      ).addedEnrollments,
    ).toBe(0);
  });
  it('importa nuevos estudiantes en bloque y actualiza solo nombres que cambian', async () => {
    prisma.student.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: studentId, ...profile }]);
    expect(
      (
        await service.importCsv({
          semesterId,
          csv: 'nombre;correo;nrc\nAna Soto;ana@example.com;10001',
        })
      ).createdStudents,
    ).toBe(1);
    prisma.student.findMany.mockResolvedValue([{ id: studentId, ...profile }]);
    await service.importCsv({
      semesterId,
      csv: 'nombre;correo;nrc\nAna Pérez;ana@example.com;10001',
    });
    expect(prisma.student.update).toHaveBeenCalledWith({
      where: { id: studentId },
      data: { name: 'Ana Pérez' },
    });
  });
  it('rechaza importar si no hay semestre activo y protege el catálogo ambiguo', async () => {
    prisma.academicSemester.findFirst.mockResolvedValue(null);
    await expect(
      service.importCsv({
        semesterId,
        csv: 'nombre;correo;nrc\nAna Soto;ana@example.com;10001',
      }),
    ).rejects.toThrow('No existe un semestre activo');
    prisma.academicSemester.findFirst.mockResolvedValue({ id: semesterId });
    prisma.studentEnrollment.findMany.mockResolvedValue([
      { nrc: '10001', course: { ...course, id: 'other-course' } },
    ]);
    await expect(
      service.save({ ...profile, semesterId, nrcs: ['10001'] }),
    ).rejects.toThrow(ConflictException);
  });
  it.each(['P2002', 'P2034'])(
    'traduce el conflicto de Prisma %s sin exponer sus detalles',
    async (code) => {
      prisma.student.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('private database error', {
          code,
          clientVersion: '7',
        }),
      );
      await expect(service.save(profile)).rejects.toThrow(ConflictException);
    },
  );
  it('valida los DTO de perfil, CSV, vínculos y paginación', async () => {
    expect(
      await validate(
        plainToInstance(StudentInputDto, {
          ...profile,
          semesterId,
          nrcs: ['10001'],
        }),
      ),
    ).toHaveLength(0);
    for (const input of [
      { ...profile, email: 'bad' },
      { ...profile, nrcs: null },
      { ...profile, nrcs: ['10001', '10001'] },
      { ...profile, semesterId: null },
    ])
      expect(
        (await validate(plainToInstance(StudentInputDto, input))).length,
      ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(ListStudentsDto, { page: 0, pageSize: 101 }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(ImportStudentsDto, { csv: 'x', semesterId: 'old' }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it.each(['create', 'update', 'importCsv'] as const)(
    'protege la operación %s por rol',
    (method) => {
      const guard = new RolesGuard(new Reflector());
      for (const role of [
        'SYSTEM_ADMIN',
        'ACADEMIC_SECRETARY',
        'ACADEMIC_PROCESS_ANALYST',
        'TEACHING_SUPPORT_COORDINATOR',
      ]) {
        const context = {
          getHandler: () => StudentsController.prototype[method],
          getClass: () => StudentsController,
          getType: () => 'http',
          switchToHttp: () => ({
            getRequest: () => ({ user: { roles: [role] } }),
          }),
        } as unknown as ExecutionContext;
        if (['SYSTEM_ADMIN', 'ACADEMIC_SECRETARY'].includes(role))
          expect(guard.canActivate(context)).toBe(true);
        else expect(() => guard.canActivate(context)).toThrow();
      }
    },
  );
});
