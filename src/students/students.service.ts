import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadCurrentCourses } from '../academic/current-courses';
import {
  ImportStudentsDto,
  ListStudentsDto,
  StudentInputDto,
  StudentCourseAttemptInputDto,
} from './students.dto';
import { parseStudentCsv } from './student-csv';

const currentEnrollments = {
  where: { semester: { isActive: true } },
  include: { course: true, semester: true },
  orderBy: { nrc: 'asc' },
} as const;
const studentCareer = {
  include: { career: { select: { id: true, code: true, name: true } } },
} as const;

const assistantshipHistory = {
  approvals: {
    include: {
      assistantships: {
        include: { course: true, semester: true },
        orderBy: { startsOn: 'desc' },
      },
    },
  },
} as const;
type Catalog = Awaited<ReturnType<typeof loadCurrentCourses>>;

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async withAssistantships<T extends { id: string; email: string }>(
    students: T[],
  ) {
    if (!students.length) return [];
    // Exact protected email lookup also recovers records created before student links existed.
    const assistants = await this.prisma.teachingAssistant.findMany({
      where: {
        OR: [
          { studentId: { in: students.map(({ id }) => id) } },
          {
            studentId: null,
            email: { in: students.map(({ email }) => email) },
          },
        ],
      },
      include: assistantshipHistory,
    });
    return students.map((student) => ({
      ...student,
      assistantships: assistants
        .filter(
          (assistant) =>
            assistant.studentId === student.id ||
            (!assistant.studentId &&
              assistant.email.trim().toLowerCase() ===
                student.email.trim().toLowerCase()),
        )
        .flatMap((assistant) =>
          assistant.approvals.flatMap((approval) => approval.assistantships),
        )
        .sort((a, b) => b.startsOn.valueOf() - a.startsOn.valueOf())
        .map((record) => ({
          id: record.id,
          course: record.course,
          semester: record.semester,
          nrc: record.nrc,
          courseNrc: record.courseNrc,
          startsOn: record.startsOn,
          endsOn: record.endsOn,
        })),
    }));
  }

  async list({ page, pageSize, search, nrc }: ListStudentsDto) {
    const where: Prisma.StudentWhereInput = {
      ...(search
        ? {
            id: { in: await this.prisma.findPiiIds('Student', search) },
          }
        : {}),
      ...(nrc
        ? { enrollments: { some: { nrc, semester: { isActive: true } } } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.student.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            enrollments: currentEnrollments,
            careerCurriculumVersion: studentCareer,
          },
        }),
        this.prisma.student.count({ where }),
      ],
      { maxWait: 10_000, timeout: 30_000 },
    );
    return {
      items: await this.withAssistantships(items),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async get(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: {
        enrollments: currentEnrollments,
        careerCurriculumVersion: studentCareer,
      },
    });
    if (!student) throw new NotFoundException('El estudiante no existe');
    return (await this.withAssistantships([student]))[0];
  }

  private async write<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      });
    } catch (cause: unknown) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === 'P2002')
          throw new ConflictException('El correo o la matrícula ya existen');
        if (cause.code === 'P2034')
          throw new ConflictException(
            'La carga académica cambió. Recarga e intenta nuevamente',
          );
        if (cause.code === 'P2025')
          throw new NotFoundException('El estudiante ya no existe');
        throw new BadRequestException('No fue posible guardar los estudiantes');
      }
      throw cause;
    }
  }

  private async catalog(
    tx: Prisma.TransactionClient,
    semesterId: string,
  ): Promise<Catalog> {
    const catalog = await loadCurrentCourses(tx);
    if (!catalog.semester)
      throw new BadRequestException('No existe un semestre activo');
    if (catalog.semester.id !== semesterId)
      throw new ConflictException(
        'El semestre activo cambió. Recarga antes de guardar',
      );
    return catalog;
  }

  private offerings(catalog: Catalog, nrcs: string[], line?: number) {
    const prefix = line ? `Fila ${line}: ` : '';
    const unique = [...new Set(nrcs)];
    return unique.map((nrc) => {
      const course = catalog.courses.find((item) => item.nrc === nrc);
      if (!course)
        throw new BadRequestException(
          `${prefix}el NRC ${nrc} no existe en el semestre activo`,
        );
      return course;
    });
  }

  save(input: StudentInputDto, id?: string) {
    return this.write(async (tx) => {
      const existingStudent = id
        ? await tx.student.findUnique({
            where: { id },
            select: { id: true, careerCurriculumVersionId: true },
          })
        : null;
      if (id && !existingStudent)
        throw new NotFoundException('El estudiante no existe');
      if ((input.nrcs === undefined) !== (input.semesterId === undefined))
        throw new BadRequestException(
          'Indica el semestre y las asignaturas juntos',
        );
      const catalog = input.semesterId
        ? await this.catalog(tx, input.semesterId)
        : null;
      const courses = catalog
        ? this.offerings(catalog, input.nrcs ?? [])
        : null;
      const data = {
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        ...(input.careerCurriculumVersionId === undefined
          ? {}
          : { careerCurriculumVersionId: input.careerCurriculumVersionId }),
      };
      if (input.careerCurriculumVersionId) {
        const curriculum = await tx.curriculumVersion.findUnique({
          where: { id: input.careerCurriculumVersionId },
          select: { id: true, career: { select: { isActive: true } } },
        });
        if (!curriculum)
          throw new BadRequestException('La malla seleccionada no existe');
        if (
          !curriculum.career.isActive &&
          curriculum.id !== existingStudent?.careerCurriculumVersionId
        )
          throw new BadRequestException(
            'La carrera seleccionada está inactiva',
          );
      }
      const student = id
        ? await tx.student.update({ where: { id }, data })
        : await tx.student.create({ data });
      if (catalog?.semester && courses) {
        await tx.studentEnrollment.deleteMany({
          where: {
            studentId: student.id,
            semesterId: catalog.semester.id,
            nrc: { notIn: courses.map(({ nrc }) => nrc) },
          },
        });
        await tx.studentEnrollment.createMany({
          data: courses.map((course) => ({
            studentId: student.id,
            semesterId: catalog.semester.id,
            courseId: course.courseId,
            nrc: course.nrc,
          })),
          skipDuplicates: true,
        });
      }
      return tx.student.findUniqueOrThrow({
        where: { id: student.id },
        include: {
          enrollments: currentEnrollments,
          careerCurriculumVersion: studentCareer,
        },
      });
    });
  }

  async progress(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: {
        careerCurriculumVersion: {
          include: {
            career: { select: { id: true, code: true, name: true } },
            courses: {
              orderBy: [{ termNumber: 'asc' }, { course: { name: 'asc' } }],
              include: {
                course: { select: { id: true, code: true, name: true } },
              },
            },
          },
        },
        courseAttempts: {
          orderBy: [{ attemptNumber: 'asc' }],
          include: {
            course: { select: { id: true, code: true, name: true } },
            semester: { select: { id: true, name: true } },
          },
        },
        enrollments: {
          where: { semester: { isActive: true } },
          select: {
            courseId: true,
            semester: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!student) throw new NotFoundException('El estudiante no existe');

    const curriculumCourses = student.careerCurriculumVersion?.courses ?? [];
    const courses = curriculumCourses.map((curriculumCourse) => {
      const attempts = student.courseAttempts.filter(
        (attempt) => attempt.courseId === curriculumCourse.courseId,
      );
      const passed = attempts.some((attempt) => attempt.outcome === 'PASSED');
      const currentEnrollment = student.enrollments.find(
        (enrollment) => enrollment.courseId === curriculumCourse.courseId,
      );
      return {
        ...curriculumCourse,
        outcome: passed ? 'PASSED' : attempts.length ? 'FAILED' : 'PENDING',
        currentEnrollment: currentEnrollment ?? null,
        attempts,
      };
    });
    const passedCourses = courses.filter(
      (course) => course.outcome === 'PASSED',
    ).length;
    const enrolledCourses = courses.filter(
      (course) => course.currentEnrollment,
    ).length;

    return {
      student: {
        id: student.id,
        name: student.name,
        email: student.email,
        curriculumVersion: student.careerCurriculumVersion,
      },
      courses,
      attempts: student.courseAttempts,
      summary: {
        totalCourses: courses.length,
        passedCourses,
        enrolledCourses,
        progressPercent: courses.length
          ? Math.round((passedCourses / courses.length) * 100)
          : 0,
      },
    };
  }

  async recordAttempt(studentId: string, input: StudentCourseAttemptInputDto) {
    return this.write(async (tx) => {
      const [student, course, semester] = await Promise.all([
        tx.student.findUnique({
          where: { id: studentId },
          select: { id: true },
        }),
        tx.course.findUnique({
          where: { id: input.courseId },
          select: { id: true },
        }),
        tx.academicSemester.findUnique({
          where: { id: input.semesterId },
          select: { id: true },
        }),
      ]);
      if (!student) throw new NotFoundException('El estudiante no existe');
      if (!course) throw new NotFoundException('La asignatura no existe');
      if (!semester) throw new NotFoundException('El semestre no existe');
      const attemptNumber =
        (await tx.studentCourseAttempt.count({
          where: { studentId, courseId: input.courseId },
        })) + 1;
      return tx.studentCourseAttempt.create({
        data: {
          studentId,
          courseId: input.courseId,
          semesterId: input.semesterId,
          attemptNumber,
          outcome: input.outcome,
          nrc: input.nrc?.trim() || null,
        },
        include: {
          course: { select: { id: true, code: true, name: true } },
          semester: { select: { id: true, name: true } },
        },
      });
    });
  }

  async importCsv(input: ImportStudentsDto) {
    const rows = parseStudentCsv(input.csv);
    return this.write(async (tx) => {
      const catalog = await this.catalog(tx, input.semesterId);
      // Validate the whole file before the first write: failures never leave partial rosters.
      const validated = rows.map((row) => ({
        ...row,
        courses: this.offerings(catalog, row.nrcs, row.line),
      }));
      const existing = await tx.student.findMany({
        where: { email: { in: rows.map(({ email }) => email) } },
        select: { id: true, email: true, name: true },
      });
      await tx.student.createMany({
        data: rows.map(({ name, email }) => ({ name, email })),
        skipDuplicates: true,
      });
      const students = await tx.student.findMany({
        where: { email: { in: rows.map(({ email }) => email) } },
        select: { id: true, email: true },
      });
      const byEmail = new Map(
        students.map((student) => [student.email, student.id]),
      );
      for (const row of validated) {
        if (!byEmail.has(row.email))
          throw new ConflictException(
            'La lista de estudiantes cambió. Reintenta la importación',
          );
        if (
          existing.some(
            (student) =>
              student.email === row.email && student.name !== row.name,
          )
        )
          await tx.student.update({
            where: { id: byEmail.get(row.email)! },
            data: { name: row.name },
          });
      }
      const links = await tx.studentEnrollment.createMany({
        data: validated.flatMap((row) =>
          row.courses.map((course) => ({
            studentId: byEmail.get(row.email)!,
            semesterId: input.semesterId,
            courseId: course.courseId,
            nrc: course.nrc,
          })),
        ),
        skipDuplicates: true,
      });
      return {
        importedStudents: rows.length,
        createdStudents: students.length - existing.length,
        addedEnrollments: links.count,
        semesterId: input.semesterId,
      };
    });
  }
}
