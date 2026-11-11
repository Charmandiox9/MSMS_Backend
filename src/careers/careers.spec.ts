import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DeleteCareerDto } from './careers.dto';
import { CareersController } from './careers.controller';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CareersService } from './careers.service';

const careerId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const courseId = '33333333-3333-4333-8333-333333333333';

describe('CareersService', () => {
  const tx = {
    career: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    curriculumVersion: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    curriculumCourse: { deleteMany: jest.fn(), createMany: jest.fn() },
    course: { findMany: jest.fn(), create: jest.fn(), createMany: jest.fn() },
  };
  const prisma = {
    career: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    course: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new CareersService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (
        operation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ) => operation(tx as unknown as Prisma.TransactionClient),
    );
    tx.course.findMany.mockResolvedValue([{ id: courseId }]);
    tx.course.create.mockResolvedValue({ id: courseId, name: 'Biología' });
    tx.career.findUnique.mockResolvedValue({ id: careerId });
    tx.career.create.mockResolvedValue({ id: careerId });
    tx.curriculumVersion.create.mockResolvedValue({ id: versionId });
    tx.career.findUniqueOrThrow.mockResolvedValue({ id: careerId });
    tx.curriculumVersion.findUniqueOrThrow.mockResolvedValue({ id: versionId });
    tx.curriculumVersion.findFirst.mockResolvedValue({
      id: versionId,
      _count: { students: 0 },
    });
  });

  const updatedAt = '2026-11-11T12:00:00.000Z';
  const deletable = () => ({
    id: careerId,
    updatedAt: new Date(updatedAt),
    _count: { assistantships: 0 },
    curriculumVersions: [{ _count: { students: 0 } }],
  });
  it('deletes unused curricula and career atomically without deleting catalog courses', async () => {
    tx.career.findUnique.mockResolvedValue(deletable());
    tx.career.deleteMany.mockResolvedValue({ count: 1 });
    await expect(service.delete(careerId, updatedAt)).resolves.toEqual({
      deleted: true,
    });
    expect(tx.curriculumVersion.deleteMany).toHaveBeenCalledWith({
      where: { careerId },
    });
    expect(tx.career.deleteMany).toHaveBeenCalledWith({
      where: { id: careerId, updatedAt: new Date(updatedAt) },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it.each(['students', 'assistantships'])(
    'blocks deletion with linked %s',
    async (kind) => {
      const career = deletable();
      if (kind === 'students') career.curriculumVersions[0]._count.students = 1;
      else career._count.assistantships = 1;
      tx.career.findUnique.mockResolvedValue(career);
      await expect(service.delete(careerId, updatedAt)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.curriculumVersion.deleteMany).not.toHaveBeenCalled();
    },
  );
  it('rejects stale deletion requests', async () => {
    tx.career.findUnique.mockResolvedValue(deletable());
    await expect(
      service.delete(careerId, '2026-11-10T12:00:00.000Z'),
    ).rejects.toThrow('Recarga');
    expect(tx.career.deleteMany).not.toHaveBeenCalled();
  });
  it('maps concurrent relation changes to a safe conflict', async () => {
    tx.career.findUnique.mockResolvedValue(deletable());
    tx.curriculumVersion.deleteMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK', {
        code: 'P2003',
        clientVersion: '7',
      }),
    );
    await expect(service.delete(careerId, updatedAt)).rejects.toThrow(
      ConflictException,
    );
  });

  it('validates the deletion timestamp and delegates the controller contract', async () => {
    expect(
      await validate(plainToInstance(DeleteCareerDto, {})),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(DeleteCareerDto, { updatedAt: 'invalid' }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(DeleteCareerDto, { updatedAt })),
    ).toHaveLength(0);
    const remove = jest
      .spyOn(service, 'delete')
      .mockResolvedValueOnce({ deleted: true });
    await new CareersController(service).delete(careerId, { updatedAt });
    expect(remove).toHaveBeenCalledWith(careerId, updatedAt);
    remove.mockRestore();
  });

  it('creates a career with its cohort curriculum in one transaction', async () => {
    const input = {
      code: 'BIO-MAR',
      name: 'Biología Marina',
      cohortYear: 2026,
      courses: [{ courseId, termNumber: 1 }],
    };

    await service.create(input);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 60_000,
    });
    expect(tx.curriculumVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          careerId,
          cohortYear: 2026,
          courses: { create: [{ courseId, termNumber: 1 }] },
        },
      }),
    );
  });

  it('creates a career and imports its first curriculum in one transaction', async () => {
    const secondCourseId = '44444444-4444-4444-8444-444444444444';
    tx.course.findMany
      .mockResolvedValueOnce([{ id: courseId, name: 'Biología Marina' }])
      .mockResolvedValueOnce([{ id: secondCourseId, name: 'Oceanografía' }]);
    const input = {
      code: 'BIO-MAR',
      name: 'Biología Marina',
      cohortYear: 2026,
      curriculumCourses: [
        { courseName: 'Biologia Marina', termNumber: 1 },
        { courseName: 'Oceanografía', termNumber: 2 },
      ],
    };

    await service.create(input);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 60_000,
    });
    expect(tx.course.createMany).toHaveBeenCalledWith({
      data: [{ name: 'Oceanografía' }],
    });
    expect(tx.curriculumVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          careerId,
          cohortYear: 2026,
          courses: {
            create: [
              { courseId, termNumber: 1 },
              { courseId: secondCourseId, termNumber: 2 },
            ],
          },
        },
      }),
    );
  });

  it('rejects a curriculum course that is not in the global catalog', async () => {
    tx.course.findMany.mockResolvedValue([]);

    await expect(
      service.create({
        code: 'BIO-MAR',
        name: 'Biología Marina',
        cohortYear: 2026,
        courses: [{ courseId, termNumber: 1 }],
      }),
    ).rejects.toThrow('Una o más asignaturas no existen');
    expect(tx.career.create).not.toHaveBeenCalled();
  });

  it('does not allow changing a curriculum already assigned to students', async () => {
    tx.curriculumVersion.findFirst.mockResolvedValue({
      id: versionId,
      _count: { students: 1 },
    });

    await expect(
      service.updateVersion(careerId, versionId, {
        courses: [{ courseId, termNumber: 1 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.curriculumCourse.deleteMany).not.toHaveBeenCalled();
  });

  it('replaces courses on an unassigned curriculum version', async () => {
    await service.updateVersion(careerId, versionId, {
      courses: [{ courseId, termNumber: 2 }],
    });

    expect(tx.curriculumCourse.deleteMany).toHaveBeenCalledWith({
      where: { curriculumVersionId: versionId },
    });
    expect(tx.curriculumCourse.createMany).toHaveBeenCalledWith({
      data: [{ curriculumVersionId: versionId, courseId, termNumber: 2 }],
    });
  });

  it('imports repeated curriculum rows and reuses one matching global course', async () => {
    tx.course.findMany
      .mockResolvedValueOnce([{ id: courseId, name: 'Biología' }])
      .mockResolvedValueOnce([
        { id: '44444444-4444-4444-8444-444444444444', name: 'Electiva' },
      ]);

    await service.importVersion(careerId, {
      cohortYear: 2026,
      courses: [
        { courseName: 'Biología', termNumber: 1 },
        { courseName: 'Biologia', termNumber: 2 },
        { courseName: 'Electiva', termNumber: 3 },
        { courseName: 'Electiva', termNumber: 3 },
      ],
    });

    expect(tx.course.createMany).toHaveBeenCalledWith({
      data: [{ name: 'Electiva' }],
    });
    expect(tx.curriculumVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          careerId,
          cohortYear: 2026,
          courses: {
            create: [
              { courseId, termNumber: 1 },
              { courseId, termNumber: 2 },
              {
                courseId: '44444444-4444-4444-8444-444444444444',
                termNumber: 3,
              },
              {
                courseId: '44444444-4444-4444-8444-444444444444',
                termNumber: 3,
              },
            ],
          },
        }),
      }),
    );
  });
});
