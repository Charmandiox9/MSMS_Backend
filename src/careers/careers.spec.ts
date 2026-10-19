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
    },
    curriculumVersion: {
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
      (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
        operation(tx as unknown as Prisma.TransactionClient),
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

  it('creates a career with its cohort curriculum in one transaction', async () => {
    const input = {
      code: 'BIO-MAR',
      name: 'Biología Marina',
      cohortYear: 2026,
      courses: [{ courseId, termNumber: 1 }],
    };

    await service.create(input);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 60_000 });
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
      .mockResolvedValueOnce([
        { id: secondCourseId, name: 'Oceanografía' },
      ]);
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

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 60_000 });
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
      .mockResolvedValueOnce([{ id: '44444444-4444-4444-8444-444444444444', name: 'Electiva' }]);

    await service.importVersion(careerId, {
      cohortYear: 2026,
      courses: [
        { courseName: 'Biología', termNumber: 1 },
        { courseName: 'Biologia', termNumber: 2 },
        { courseName: 'Electiva', termNumber: 3 },
        { courseName: 'Electiva', termNumber: 3 },
      ],
    });

    expect(tx.course.createMany).toHaveBeenCalledWith({ data: [{ name: 'Electiva' }] });
    expect(tx.curriculumVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          careerId,
          cohortYear: 2026,
          courses: {
            create: [
              { courseId, termNumber: 1 },
              { courseId, termNumber: 2 },
              { courseId: '44444444-4444-4444-8444-444444444444', termNumber: 3 },
              { courseId: '44444444-4444-4444-8444-444444444444', termNumber: 3 },
            ],
          },
        }),
      }),
    );
  });
});
