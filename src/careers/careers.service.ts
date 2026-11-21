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
  CurriculumCourseInputDto,
  ImportCurriculumDto,
  UpdateCareerDto,
  UpdateCurriculumVersionDto,
} from './careers.dto';

const careerInclude = {
  department: { select: { id: true, name: true } },
  curriculumVersions: {
    orderBy: { cohortYear: 'desc' as const },
    include: {
      _count: { select: { students: true } },
      cohorts: {
        orderBy: { cohortYear: 'asc' as const },
        select: { cohortYear: true },
      },
      courses: {
        orderBy: [
          { termNumber: 'asc' as const },
          { course: { name: 'asc' as const } },
        ],
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
          select: {
            id: true,
            cohortYear: true,
            cohorts: careerInclude.curriculumVersions.include.cohorts,
          },
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
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('es');
  }

  private async resolveNamedCourses(
    tx: Prisma.TransactionClient,
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
        throw new BadRequestException(
          `La asignatura «${courseName}» coincide con más de un registro del catálogo`,
        );
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

    return input.map(({ courseName, termNumber }) => {
      const courseId = resolved.get(this.normalizeCourseName(courseName));
      if (!courseId)
        throw new BadRequestException(
          `No fue posible resolver la asignatura «${courseName}»`,
        );
      return { courseId, termNumber };
    });
  }

  private async resolveManualCourses(
    tx: Prisma.TransactionClient,
    { courses = [], newCourses }: UpdateCurriculumVersionDto,
  ) {
    const selected = courses ?? [];
    const total = selected.length + (newCourses?.length ?? 0);
    if (total < 1 || total > 300)
      throw new BadRequestException(
        'La malla debe tener entre 1 y 300 asignaturas',
      );
    if (selected.length)
      await this.assertCoursesExist(
        tx,
        selected.map(({ courseId }) => courseId),
      );
    const named = newCourses
      ? await this.resolveNamedCourses(tx, newCourses)
      : [];
    return [...selected, ...named];
  }

  async importVersion(careerId: string, input: ImportCurriculumDto) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const career = await tx.career.findUnique({
            where: { id: careerId },
          });
          if (!career) throw new NotFoundException('La carrera no existe');
          return this.createVersion(
            tx,
            careerId,
            input.cohortYear,
            await this.resolveNamedCourses(tx, input.courses),
          );
        },
        {
          maxWait: 10_000,
          timeout: 60_000,
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (cause: unknown) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === 'P2002')
          throw new ConflictException('Ya existe una malla para esa cohorte');
        if (cause.code === 'P2034')
          throw new ConflictException(
            'Los datos cambiaron. Recarga e intenta nuevamente',
          );
      }
      throw cause;
    }
  }

  private async createVersion(
    tx: Prisma.TransactionClient,
    careerId: string,
    cohortYear: number,
    courses: CurriculumCourseInputDto[],
  ) {
    return tx.curriculumVersion.create({
      data: {
        careerId,
        cohortYear,
        cohorts: { create: { cohortYear } },
        courses: {
          create: courses.map(({ courseId, termNumber }) => ({
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
      return await this.prisma.$transaction(
        async (tx) => {
          const hasManualCourses = Boolean(input.courses || input.newCourses);
          const importedCourses = input.curriculumCourses;
          if (hasManualCourses === Boolean(importedCourses))
            throw new BadRequestException(
              'Debes agregar asignaturas manualmente o importar una malla CSV',
            );
          const courses = importedCourses
            ? await this.resolveNamedCourses(tx, importedCourses)
            : await this.resolveManualCourses(tx, input);
          const career = await tx.career.create({
            data: {
              code: input.code?.trim() || null,
              name: input.name.trim(),
              departmentId: input.departmentId,
            },
          });
          await this.createVersion(tx, career.id, input.cohortYear, courses);
          return tx.career.findUniqueOrThrow({
            where: { id: career.id },
            include: careerInclude,
          });
        },
        {
          maxWait: 10_000,
          timeout: 60_000,
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (cause: unknown) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === 'P2003' && input.departmentId)
          throw new BadRequestException(
            'El departamento seleccionado no existe',
          );
        if (cause.code === 'P2002')
          throw new ConflictException(
            'El código o nombre de carrera ya existe',
          );
        if (cause.code === 'P2034')
          throw new ConflictException(
            'Los datos cambiaron. Recarga e intenta nuevamente',
          );
      }
      throw cause;
    }
  }

  async update(id: string, input: UpdateCareerDto) {
    try {
      return await this.prisma.career.update({
        where: { id },
        data: {
          ...(input.code === undefined
            ? {}
            : { code: input.code?.trim() || null }),
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.departmentId === undefined
            ? {}
            : { departmentId: input.departmentId }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
        include: careerInclude,
      });
    } catch (cause: unknown) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === 'P2003' && input.departmentId)
          throw new BadRequestException(
            'El departamento seleccionado no existe',
          );
        if (cause.code === 'P2002')
          throw new ConflictException(
            'El código o nombre de carrera ya existe',
          );
        if (cause.code === 'P2025')
          throw new NotFoundException('La carrera no existe');
      }
      throw cause;
    }
  }

  async delete(id: string, updatedAt: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const career = await tx.career.findUnique({
            where: { id },
            include: {
              _count: { select: { assistantships: true } },
              curriculumVersions: {
                select: { _count: { select: { students: true } } },
              },
            },
          });
          if (!career) throw new NotFoundException('La carrera no existe');
          if (
            career.updatedAt.toISOString() !== new Date(updatedAt).toISOString()
          )
            throw new ConflictException(
              'La carrera cambió. Recarga antes de eliminar',
            );
          if (
            career._count.assistantships ||
            career.curriculumVersions.some(
              (version) => version._count.students > 0,
            )
          )
            throw new ConflictException(
              'La carrera tiene estudiantes o ayudantías vinculadas. Puedes desactivarla para conservar su historial',
            );
          await tx.curriculumVersion.deleteMany({ where: { careerId: id } });
          const result = await tx.career.deleteMany({
            where: { id, updatedAt: new Date(updatedAt) },
          });
          if (!result.count)
            throw new ConflictException(
              'La carrera cambió. Recarga antes de eliminar',
            );
          return { deleted: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (cause: unknown) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2003', 'P2034'].includes(cause.code)
      )
        throw new ConflictException(
          'La carrera cambió o tiene registros vinculados. Recarga antes de eliminar',
        );
      throw cause;
    }
  }

  async addVersion(careerId: string, input: AddCurriculumVersionDto) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const career = await tx.career.findUnique({
            where: { id: careerId },
          });
          if (!career) throw new NotFoundException('La carrera no existe');
          if (input.existingVersionId) {
            if (input.courses || input.newCourses)
              throw new BadRequestException(
                'Selecciona una malla existente o ingresa asignaturas para una nueva',
              );
            const version = await tx.curriculumVersion.findFirst({
              where: { id: input.existingVersionId, careerId },
              select: { id: true },
            });
            if (!version)
              throw new NotFoundException(
                'La versión de malla no existe en la carrera',
              );
            await tx.curriculumCohort.create({
              data: {
                careerId,
                cohortYear: input.cohortYear,
                curriculumVersionId: version.id,
              },
            });
            return tx.curriculumVersion.findUniqueOrThrow({
              where: { id: version.id },
              include: careerInclude.curriculumVersions.include,
            });
          }
          const courses = await this.resolveManualCourses(tx, input);
          return this.createVersion(tx, careerId, input.cohortYear, courses);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (cause: unknown) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === 'P2002')
          throw new ConflictException('Ya existe una malla para esa cohorte');
        if (cause.code === 'P2034' || cause.code === 'P2003')
          throw new ConflictException(
            'Los datos cambiaron. Recarga e intenta nuevamente',
          );
      }
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
            select: {
              id: true,
              _count: { select: { students: true, cohorts: true } },
            },
          });
          if (!version)
            throw new NotFoundException('La versión de malla no existe');
          if (version._count.students > 0)
            throw new ConflictException(
              'La malla ya está asignada a estudiantes y no puede modificarse',
            );
          if (version._count.cohorts > 1)
            throw new ConflictException(
              'La malla ya está compartida por varias cohortes',
            );
          const courses = await this.resolveManualCourses(tx, input);
          await tx.curriculumCourse.deleteMany({
            where: { curriculumVersionId: versionId },
          });
          await tx.curriculumCourse.createMany({
            data: courses.map(({ courseId, termNumber }) => ({
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
