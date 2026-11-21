import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AddCurriculumVersionDto,
  CreateCareerFromCsvDto,
  DeleteCareerDto,
  UpdateCareerDto,
} from './careers.dto';
import { CareersController } from './careers.controller';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CareersService } from './careers.service';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

const careerId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const courseId = '33333333-3333-4333-8333-333333333333';
const departmentId = '44444444-4444-4444-8444-444444444444';

describe('CareersService', () => {
  const tx = {
    career: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
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
    curriculumCohort: { create: jest.fn() },
    student: { findMany: jest.fn(), updateMany: jest.fn() },
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

  it('allows the titulation coordinator to load career select options', () => {
    const roles: unknown = Reflect.getMetadata(
      ROLES_KEY,
      CareersController.prototype.options,
    );

    expect(roles).toEqual(
      expect.arrayContaining(['TEACHING_SUPPORT_COORDINATOR']),
    );
  });

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
    tx.student.findMany.mockResolvedValue([]);
    tx.curriculumVersion.create.mockResolvedValue({ id: versionId });
    tx.career.findUniqueOrThrow.mockResolvedValue({ id: careerId });
    tx.curriculumVersion.findUniqueOrThrow.mockResolvedValue({ id: versionId });
    tx.curriculumVersion.findFirst.mockResolvedValue({
      id: versionId,
      _count: { students: 0, cohorts: 1 },
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
      departmentId,
      cohortYear: 2026,
      courses: [{ courseId, termNumber: 1 }],
    };

    await service.create(input);

    expect(tx.career.create).toHaveBeenCalledWith({
      data: { code: input.code, name: input.name, departmentId },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 60_000,
      isolationLevel: 'Serializable',
    });
    expect(tx.curriculumVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          careerId,
          cohortYear: 2026,
          cohorts: { create: { cohortYear: 2026 } },
          courses: { create: [{ courseId, termNumber: 1 }] },
        },
      }),
    );
  });

  it('registers a cohort against the selected plan without writing a new version or courses', async () => {
    const controller = new CareersController(service);
    const input = { cohortYear: 2027, existingVersionId: versionId };
    expect(
      await validate(plainToInstance(AddCurriculumVersionDto, input)),
    ).toEqual([]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        CareersController.prototype.addCurriculumVersion,
      ),
    ).toEqual(['ACADEMIC_SECRETARY']);

    await expect(
      controller.addCurriculumVersion(careerId, input),
    ).resolves.toEqual({ id: versionId });
    expect(tx.curriculumVersion.findFirst).toHaveBeenCalledWith({
      where: { id: versionId, careerId },
      select: { id: true },
    });
    expect(tx.curriculumCohort.create).toHaveBeenCalledWith({
      data: { careerId, cohortYear: 2027, curriculumVersionId: versionId },
    });
    expect(tx.curriculumVersion.create).not.toHaveBeenCalled();
    expect(tx.course.createMany).not.toHaveBeenCalled();
  });

  it('rejects unavailable plans and conflicting cohort registrations', async () => {
    const input = { cohortYear: 2027, existingVersionId: versionId };
    tx.curriculumVersion.findFirst.mockResolvedValueOnce(null);
    await expect(service.addVersion(careerId, input)).rejects.toThrow(
      'no existe en la carrera',
    );
    expect(tx.curriculumCohort.create).not.toHaveBeenCalled();
    tx.curriculumCohort.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Duplicate', {
        code: 'P2002',
        clientVersion: '7',
      }),
    );
    await expect(service.addVersion(careerId, input)).rejects.toThrow(
      ConflictException,
    );
    await expect(
      service.addVersion(careerId, {
        ...input,
        courses: [{ courseId, termNumber: 1 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('assigns only pending students with the matching admission year and an unambiguous career', async () => {
    tx.career.findMany.mockResolvedValue([
      { id: careerId, code: 'BM', name: 'Ingeniería Marina' },
      { id: 'other', code: 'OC', name: 'Oceanografía' },
      { id: 'ambiguous', code: null, name: 'Oceanografia' },
    ]);
    const student = {
      careerId: null,
      admission: '202710',
      importedCareerCode: null,
      importedCareerName: null,
    };
    tx.student.findMany.mockResolvedValueOnce([
      { ...student, id: 'direct', careerId, admission: '202720' },
      {
        ...student,
        id: 'code',
        importedCareerCode: ' bm ',
        importedCareerName: 'Oceanografía',
      },
      { ...student, id: 'name', importedCareerName: 'Ing. MARINA' },
      { ...student, id: 'other-year', careerId, admission: '202610' },
      {
        ...student,
        id: 'other-career',
        careerId: 'other',
        importedCareerCode: 'BM',
      },
      { ...student, id: 'ambiguous', importedCareerName: 'Oceanografia' },
      { ...student, id: 'partial', importedCareerName: 'Ingeniería' },
      { ...student, id: 'none' },
    ]);
    await service.addVersion(careerId, {
      cohortYear: 2027,
      existingVersionId: versionId,
    });
    expect(tx.student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          careerCurriculumVersionId: null,
          admission: { not: null },
        }),
      }),
    );
    expect(tx.student.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['direct', 'code', 'name'] },
        careerCurriculumVersionId: null,
        OR: [{ careerId }, { careerId: null }],
      },
      data: { careerId, careerCurriculumVersionId: versionId },
    });
  });

  it('saves named manual courses alongside catalog selections in the same transaction', async () => {
    const newId = '55555555-5555-4555-8555-555555555555';
    tx.course.findMany
      .mockResolvedValueOnce([{ id: courseId }])
      .mockResolvedValueOnce([{ id: courseId, name: 'Biología' }])
      .mockResolvedValueOnce([{ id: newId, name: 'Oceanografía' }]);
    const input = {
      cohortYear: 2027,
      courses: [{ courseId, termNumber: 1 }],
      newCourses: [
        { courseName: 'Oceanografía', termNumber: 2 },
        { courseName: 'Biologia', termNumber: 3 },
      ],
    };
    await service.addVersion(careerId, input);
    expect(tx.student.findMany).toHaveBeenCalled();
    expect(tx.course.createMany).toHaveBeenCalledWith({
      data: [{ name: 'Oceanografía' }],
    });
    expect(tx.curriculumVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          careerId,
          cohortYear: 2027,
          cohorts: { create: { cohortYear: 2027 } },
          courses: {
            create: [
              input.courses[0],
              { courseId: newId, termNumber: 2 },
              { courseId, termNumber: 3 },
            ],
          },
        },
      }),
    );
    expect(
      await validate(
        plainToInstance(AddCurriculumVersionDto, {
          cohortYear: 2027,
          newCourses: [{ courseName: ' ', termNumber: 21 }],
        }),
      ),
    ).not.toHaveLength(0);
  });

  it('blocks edits to a shared plan even before students are assigned', async () => {
    tx.curriculumVersion.findFirst.mockResolvedValueOnce({
      id: versionId,
      _count: { students: 0, cohorts: 2 },
    });
    await expect(
      service.updateVersion(careerId, versionId, {
        courses: [{ courseId, termNumber: 1 }],
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.curriculumCourse.deleteMany).not.toHaveBeenCalled();
  });

  it('assigns and clears career departments while preserving omitted assignments', async () => {
    await service.update(careerId, { departmentId });
    await service.update(careerId, { departmentId: null });
    await service.update(careerId, { isActive: false });

    expect(
      prisma.career.update.mock.calls.map(([query]) => query.data),
    ).toEqual([{ departmentId }, { departmentId: null }, { isActive: false }]);
  });

  it('rejects an unknown department in a career update', async () => {
    prisma.career.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('FK', {
        code: 'P2003',
        clientVersion: '7',
      }),
    );
    await expect(service.update(careerId, { departmentId })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('validates department identifiers on updates and CSV jobs', async () => {
    for (const input of [
      plainToInstance(UpdateCareerDto, { departmentId: 'invalid' }),
      plainToInstance(CreateCareerFromCsvDto, { departmentId: 'invalid' }),
    ]) {
      expect(await validate(input)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'departmentId' }),
        ]),
      );
    }
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
      isolationLevel: 'Serializable',
    });
    expect(tx.course.createMany).toHaveBeenCalledWith({
      data: [{ name: 'Oceanografía' }],
    });
    expect(tx.curriculumVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          careerId,
          cohortYear: 2026,
          cohorts: { create: { cohortYear: 2026 } },
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
