import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddCurriculumVersionDto,
  CreateCareerDto,
  ImportCurriculumDto,
  UpdateCareerDto,
  UpdateCurriculumVersionDto,
} from './careers.dto';

const careerInclude = {
  curriculumVersions: {
    orderBy: { cohortYear: 'desc' as const },
    include: {
      _count: { select: { students: true } },
      courses: {
        orderBy: [{ termNumber: 'asc' as const }, { course: { name: 'asc' as const } }],
        include: { course: { select: { id: true, code: true, name: true } } },
      },
    },
  },
} satisfies Prisma.CareerInclude;

@Injectable()
export class CareersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.career.findMany({
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
      include: careerInclude,
    });
  }

  options() {
    return this.prisma.career.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        curriculumVersions: {
          orderBy: { cohortYear: 'desc' },
          select: { id: true, cohortYear: true },
        },
      },
    });
  }

  courseOptions() {
    return this.prisma.course.findMany({
      select: { id: true, code: true, name: true },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
  }

  private async assertCoursesExist(
    tx: Prisma.TransactionClient,
    courseIds: string[],
  ) {
    const courses = await tx.course.findMany({
      where: { id: { in: [...new Set(courseIds)] } },
      select: { id: true },
    });
    if (courses.length !== new Set(courseIds).size)
      throw new BadRequestException('Una o más asignaturas no existen');
  }

  private normalizeCourseName(value: string) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es');
  }

  private async createImportedVersion(
    tx: Prisma.TransactionClient,
    careerId: string,
    cohortYear: number,
    input: ImportCurriculumDto['courses'],
  ) {
    const catalog = await tx.course.findMany({
      select: { id: true, name: true },
    });
    const byName = new Map<string, { id: string; name: string }[]>();
    for (const course of catalog) {
      const key = this.normalizeCourseName(course.name);
      byName.set(key, [...(byName.get(key) ?? []), course]);
    }

    const resolved = new Map<string, string>();
    const missing = new Map<string, string>();
    for (const { courseName } of input) {
      const key = this.normalizeCourseName(courseName);
      const matches = byName.get(key) ?? [];
      if (matches.length > 1)
        throw new BadRequestException(`La asignatura «${courseName}» coincide con más de un registro del catálogo`);
      if (matches[0]) resolved.set(key, matches[0].id);
      else if (!missing.has(key)) missing.set(key, courseName.trim());
    }

    if (missing.size > 0) {
      const names = [...missing.values()];
      await tx.course.createMany({ data: names.map((name) => ({ name })) });
      const created = await tx.course.findMany({
        where: { name: { in: names } },
        select: { id: true, name: true },
      });
      for (const course of created)
        resolved.set(this.normalizeCourseName(course.name), course.id);
    }

    const courseIds = input.map(({ courseName }) => {
      const courseId = resolved.get(this.normalizeCourseName(courseName));
      if (!courseId)
        throw new BadRequestException(`No fue posible resolver la asignatura «${courseName}»`);
      return courseId;
    });

    return tx.curriculumVersion.create({
      data: {
        careerId,
        cohortYear,
        courses: {
          create: input.map(({ termNumber }, index) => ({
            courseId: courseIds[index],
            termNumber,
          })),
        },
      },
      include: careerInclude.curriculumVersions.include,
    });
  }

  async importVersion(careerId: string, input: ImportCurriculumDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const career = await tx.career.findUnique({ where: { id: careerId } });
        if (!career) throw new NotFoundException('La carrera no existe');
        return this.createImportedVersion(
          tx,
          careerId,
          input.cohortYear,
          input.courses,
        );
      }, { maxWait: 10_000, timeout: 60_000 });
    } catch (cause: unknown) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002')
        throw new ConflictException('Ya existe una malla para esa cohorte');
      throw cause;
    }
  }

  private async createVersion(
    tx: Prisma.TransactionClient,
    careerId: string,
    input: AddCurriculumVersionDto,
    coursesAlreadyValidated = false,
  ) {
    if (!coursesAlreadyValidated)
      await this.assertCoursesExist(
        tx,
        input.courses.map(({ courseId }) => courseId),
      );
    return tx.curriculumVersion.create({
      data: {
        careerId,
        cohortYear: input.cohortYear,
        courses: {
          create: input.courses.map(({ courseId, termNumber }) => ({
            courseId,
            termNumber,
          })),
        },
      },
      include: careerInclude.curriculumVersions.include,
    });
  }

  async create(input: CreateCareerDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const manualCourses = input.courses;
        const importedCourses = input.curriculumCourses;
        if (Boolean(manualCourses) === Boolean(importedCourses))
          throw new BadRequestException('Debes agregar asignaturas manualmente o importar una malla CSV');
        if (manualCourses)
          await this.assertCoursesExist(
            tx,
            manualCourses.map(({ courseId }) => courseId),
          );
        const career = await tx.career.create({
          data: { code: input.code.trim(), name: input.name.trim() },
        });
        if (importedCourses) {
          await this.createImportedVersion(
            tx,
            career.id,
            input.cohortYear,
            importedCourses,
          );
        } else if (manualCourses) {
          await this.createVersion(tx, career.id, {
            cohortYear: input.cohortYear,
            courses: manualCourses,
          }, true);
        }
        return tx.career.findUniqueOrThrow({
          where: { id: career.id },
          include: careerInclude,
        });
      }, { maxWait: 10_000, timeout: 60_000 });
    } catch (cause: unknown) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === 'P2002')
          throw new ConflictException('El código o nombre de carrera ya existe');
      }
      throw cause;
    }
  }

  async update(id: string, input: UpdateCareerDto) {
    try {
      return await this.prisma.career.update({
        where: { id },
        data: {
          ...(input.code === undefined ? {} : { code: input.code.trim() }),
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
        include: careerInclude,
      });
    } catch (cause: unknown) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === 'P2002')
          throw new ConflictException('El código o nombre de carrera ya existe');
        if (cause.code === 'P2025')
          throw new NotFoundException('La carrera no existe');
      }
      throw cause;
    }
  }

  async addVersion(careerId: string, input: AddCurriculumVersionDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const career = await tx.career.findUnique({ where: { id: careerId } });
        if (!career) throw new NotFoundException('La carrera no existe');
        return this.createVersion(tx, careerId, input);
      });
    } catch (cause: unknown) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002')
        throw new ConflictException('Ya existe una malla para esa cohorte');
      throw cause;
    }
  }

  async updateVersion(
    careerId: string,
    versionId: string,
    input: UpdateCurriculumVersionDto,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const version = await tx.curriculumVersion.findFirst({
            where: { id: versionId, careerId },
            select: { id: true, _count: { select: { students: true } } },
          });
          if (!version)
            throw new NotFoundException('La versión de malla no existe');
          if (version._count.students > 0)
            throw new ConflictException(
              'La malla ya está asignada a estudiantes y no puede modificarse',
            );
          await this.assertCoursesExist(
            tx,
            input.courses.map(({ courseId }) => courseId),
          );
          await tx.curriculumCourse.deleteMany({
            where: { curriculumVersionId: versionId },
          });
          await tx.curriculumCourse.createMany({
            data: input.courses.map(({ courseId, termNumber }) => ({
              curriculumVersionId: versionId,
              courseId,
              termNumber,
            })),
          });
          return tx.curriculumVersion.findUniqueOrThrow({
            where: { id: versionId },
            include: careerInclude.curriculumVersions.include,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (cause: unknown) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === 'P2034'
      )
        throw new ConflictException(
          'La malla cambió durante la edición. Recarga e intenta nuevamente',
        );
      throw cause;
    }
  }
}
