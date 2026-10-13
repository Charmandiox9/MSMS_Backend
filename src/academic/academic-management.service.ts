import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadCurrentCourses } from './current-courses';
import {
  CourseTeachersDto,
  CreateCourseDto,
  TeacherInputDto,
} from './academic-management.dto';

@Injectable()
export class AcademicManagementService {
  constructor(private readonly prisma: PrismaService) {}

  /** A semester offering is identified by NRC, not by a global course alone. */
  async currentCourses() {
    return this.prisma.$transaction((tx) => this.catalog(tx));
  }

  private catalog(tx: Prisma.TransactionClient) {
    return loadCurrentCourses(tx);
  }

  private async activeSemester(
    tx: Prisma.TransactionClient,
    semesterId: string,
  ) {
    const semester = await tx.academicSemester.findFirst({
      where: { isActive: true },
    });
    if (!semester)
      throw new BadRequestException('No existe un semestre activo');
    if (semester.id !== semesterId)
      throw new ConflictException(
        'El semestre activo cambió. Recarga antes de guardar',
      );
    return semester;
  }

  private async write<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002')
          throw new ConflictException(
            'Ya existe un registro con ese correo, código o NRC',
          );
        if (error.code === 'P2025')
          throw new NotFoundException('El registro ya no existe');
        if (error.code === 'P2003')
          throw new ConflictException(
            'El vínculo tiene registros asociados y no se puede eliminar',
          );
        if (error.code === 'P2034')
          throw new ConflictException(
            'Los datos cambiaron mientras guardabas. Recarga e intenta nuevamente',
          );
        throw new BadRequestException(
          'No fue posible guardar el registro académico',
        );
      }
      throw error;
    }
  }

  private profile(input: TeacherInputDto) {
    return {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      employeeCode: input.employeeCode?.trim() || null,
    };
  }

  createTeacher(input: TeacherInputDto) {
    return this.write(async (tx) => {
      const teacher = await tx.teacher.create({ data: this.profile(input) });
      await this.assignTeacher(tx, teacher.id, input);
      return tx.teacher.findUniqueOrThrow({
        where: { id: teacher.id },
        include: {
          assignments: {
            where: { semester: { isActive: true } },
            include: { course: true, semester: true },
          },
        },
      });
    });
  }

  updateTeacher(id: string, input: TeacherInputDto) {
    return this.write(async (tx) => {
      if (!(await tx.teacher.findUnique({ where: { id } })))
        throw new NotFoundException('El docente no existe');
      await tx.teacher.update({ where: { id }, data: this.profile(input) });
      await this.assignTeacher(tx, id, input);
      return tx.teacher.findUniqueOrThrow({
        where: { id },
        include: {
          assignments: {
            where: { semester: { isActive: true } },
            include: { course: true, semester: true },
          },
        },
      });
    });
  }

  private async assignTeacher(
    tx: Prisma.TransactionClient,
    teacherId: string,
    input: TeacherInputDto,
  ) {
    if (input.nrcs === undefined && input.semesterId === undefined) return;
    if (input.nrcs === undefined || !input.semesterId)
      throw new BadRequestException(
        'Debes indicar el semestre y las asignaturas',
      );
    const semester = await this.activeSemester(tx, input.semesterId);
    const catalog = await this.catalog(tx);
    const selected = catalog.courses.filter(({ nrc }) =>
      input.nrcs!.includes(nrc),
    );
    if (selected.length !== input.nrcs.length)
      throw new BadRequestException(
        'Solo puedes vincular asignaturas existentes del semestre activo',
      );
    const where = { teacherId, semesterId: semester.id };
    const existing = await tx.teachingAssignment.findMany({ where });
    const removed = existing.filter(
      (item) =>
        !selected.some(
          (course) =>
            course.nrc === item.nrc && course.courseId === item.courseId,
        ),
    );
    await this.removeAssignments(
      tx,
      removed.map(({ id }) => id),
    );
    for (const course of selected) {
      if (
        !existing.some(
          (item) =>
            item.nrc === course.nrc && item.courseId === course.courseId,
        )
      )
        await tx.teachingAssignment.create({
          data: { ...where, courseId: course.courseId, nrc: course.nrc },
        });
    }
  }

  private async removeAssignments(tx: Prisma.TransactionClient, ids: string[]) {
    if (!ids.length) return;
    if (
      await tx.assistantship.count({
        where: { teachingAssignmentId: { in: ids } },
      })
    )
      throw new ConflictException(
        'No puedes desvincular una asignatura con ayudantías asociadas',
      );
    await tx.teachingAssignment.deleteMany({ where: { id: { in: ids } } });
  }

  async createCourse(input: CreateCourseDto) {
    if (
      new Set(input.schedules.map(({ day, block }) => `${day}|${block}`))
        .size !== input.schedules.length
    )
      throw new BadRequestException('No puedes repetir el mismo día y bloque');
    return this.write(async (tx) => {
      const semester = await this.activeSemester(tx, input.semesterId);
      const nrc = input.nrc.trim();
      const catalog = await this.catalog(tx);
      if (catalog.courses.some((course) => course.nrc === nrc))
        throw new ConflictException('El NRC ya existe en el semestre activo');
      const name = input.name.trim();
      const code = input.code?.trim() || null;
      // Reuse the catalog record without changing offerings in past semesters.
      const course =
        (await tx.course.findFirst({ where: { name, code } })) ??
        (await tx.course.create({ data: { name, code } }));
      await tx.courseSchedule.createMany({
        data: input.schedules.map((schedule) => ({
          semesterId: semester.id,
          courseId: course.id,
          nrc,
          day: schedule.day,
          block: schedule.block,
          location: schedule.location?.trim() || null,
        })),
      });
      return { courseId: course.id, nrc };
    });
  }

  setCourseTeachers(nrc: string, input: CourseTeachersDto) {
    return this.write(async (tx) => {
      const semester = await this.activeSemester(tx, input.semesterId);
      const catalog = await this.catalog(tx);
      const course = catalog.courses.find((item) => item.nrc === nrc);
      if (!course)
        throw new NotFoundException(
          'La asignatura no existe en el semestre activo',
        );
      const teachers = await tx.teacher.findMany({
        where: { id: { in: input.teacherIds } },
        select: { id: true },
      });
      if (teachers.length !== input.teacherIds.length)
        throw new BadRequestException('Uno o más docentes no existen');
      const where = { semesterId: semester.id, courseId: course.courseId, nrc };
      const existing = await tx.teachingAssignment.findMany({ where });
      await this.removeAssignments(
        tx,
        existing
          .filter(({ teacherId }) => !input.teacherIds.includes(teacherId))
          .map(({ id }) => id),
      );
      for (const teacherId of input.teacherIds) {
        if (!existing.some((item) => item.teacherId === teacherId))
          await tx.teachingAssignment.create({ data: { ...where, teacherId } });
      }
      return { nrc, teacherIds: input.teacherIds };
    });
  }
}
