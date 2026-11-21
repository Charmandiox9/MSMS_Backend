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
const titulationHistory = {
  select: {
    id: true,
    stage: true,
    outcome: true,
    careerName: true,
    degree: true,
    defenseDate: true,
    createdAt: true,
  },
  orderBy: { createdAt: 'desc' },
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

  private async withAssistantships<
    T extends { id: string; email: string | null },
  >(students: T[]) {
    if (!students.length) return [];
    // Exact protected email lookup also recovers records created before student links existed.
    const assistants = await this.prisma.teachingAssistant.findMany({
      where: {
        OR: [
          { studentId: { in: students.map(({ id }) => id) } },
          {
            studentId: null,
            email: {
              in: students.flatMap(({ email }) => (email ? [email] : [])),
            },
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
              student.email &&
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

  async list({
    page,
    pageSize,
    search,
    nrc,
    careerId,
    cohortYear,
    sortBy,
    sortOrder = 'asc',
  }: ListStudentsDto) {
    const piiFilters: string[][] = [];
    if (search)
      piiFilters.push(await this.prisma.findPiiIds('Student', search));
    if (cohortYear)
      piiFilters.push(
        await this.prisma.findPiiIds('Student', String(cohortYear), [
          'admission',
        ]),
      );
    const matchingIds = piiFilters.length
      ? piiFilters
          .slice(1)
          .reduce(
            (current, ids) => current.filter((id) => ids.includes(id)),
            piiFilters[0],
          )
      : null;
    const where: Prisma.StudentWhereInput = {
      ...(matchingIds ? { id: { in: matchingIds } } : {}),
      ...(careerId ? { careerId } : {}),
      ...(nrc
        ? { enrollments: { some: { nrc, semester: { isActive: true } } } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.student.findMany({
          where,
          orderBy: sortBy
            ? { id: 'asc' }
            : [{ createdAt: 'desc' }, { id: 'asc' }],
          ...(!sortBy ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
          include: {
            enrollments: currentEnrollments,
            careerCurriculumVersion: studentCareer,
            career: { select: { id: true, code: true, name: true } },
            titulationProcesses: titulationHistory,
          },
        }),
        this.prisma.student.count({ where }),
      ],
      { maxWait: 10_000, timeout: 30_000 },
    );
    const orderedItems = sortBy
      ? items.sort((left, right) => {
          const leftValue =
            sortBy === 'name'
              ? (left.givenNames ?? left.name)
              : `${left.paternalSurname ?? ''} ${left.maternalSurname ?? ''} ${left.givenNames ?? left.name}`;
          const rightValue =
            sortBy === 'name'
              ? (right.givenNames ?? right.name)
              : `${right.paternalSurname ?? ''} ${right.maternalSurname ?? ''} ${right.givenNames ?? right.name}`;
          const comparison = leftValue.localeCompare(rightValue, 'es', {
            sensitivity: 'base',
          });
          return (
            (sortOrder === 'desc' ? -comparison : comparison) ||
            left.id.localeCompare(right.id)
          );
        })
      : items;
    const pageItems = sortBy
      ? orderedItems.slice((page - 1) * pageSize, page * pageSize)
      : orderedItems;
    return {
      items: await this.withAssistantships(pageItems),
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
        career: { select: { id: true, code: true, name: true } },
        titulationProcesses: titulationHistory,
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
            select: {
              id: true,
              careerId: true,
              careerCurriculumVersionId: true,
            },
          })
        : null;
      if (id && !existingStudent)
        throw new NotFoundException('El estudiante no existe');
      if ((input.nrcs === undefined) !== (input.semesterId === undefined))
        throw new BadRequestException(
          'Indica el semestre y las asignaturas juntos',
        );
      if (
        input.admission !== undefined &&
        input.admission !== null &&
        !/^\d{4}(10|20)$/.test(String(input.admission))
      )
        throw new BadRequestException(
          'Admisión debe tener seis dígitos y terminar en 10 o 20',
        );
      const catalog = input.semesterId
        ? await this.catalog(tx, input.semesterId)
        : null;
      const courses = catalog
        ? this.offerings(catalog, input.nrcs ?? [])
        : null;
      const data = {
        name: input.name.trim(),
        ...(input.email === undefined
          ? {}
          : { email: input.email?.trim().toLowerCase() || null }),
        ...(input.givenNames === undefined
          ? {}
          : { givenNames: input.givenNames?.trim() || null }),
        ...(input.rut === undefined ? {} : { rut: input.rut?.trim() || null }),
        ...(input.personalEmail === undefined
          ? {}
          : {
              personalEmail: input.personalEmail?.trim().toLowerCase() || null,
            }),
        ...(input.admission === undefined
          ? {}
          : { admission: input.admission ?? null }),
        ...(input.paternalSurname === undefined
          ? {}
          : { paternalSurname: input.paternalSurname?.trim() || null }),
        ...(input.maternalSurname === undefined
          ? {}
          : { maternalSurname: input.maternalSurname?.trim() || null }),
        ...(input.birthDate === undefined
          ? {}
          : { birthDate: input.birthDate?.slice(0, 10) || null }),
        ...(input.careerCurriculumVersionId === undefined
          ? {}
          : { careerCurriculumVersionId: input.careerCurriculumVersionId }),
        ...(input.careerId === undefined ? {} : { careerId: input.careerId }),
      };
      if (input.careerCurriculumVersionId) {
        const curriculum = await tx.curriculumVersion.findUnique({
          where: { id: input.careerCurriculumVersionId },
          select: {
            id: true,
            career: { select: { id: true, isActive: true } },
          },
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
        if (input.careerId && input.careerId !== curriculum.career.id)
          throw new BadRequestException(
            'La carrera no coincide con la malla seleccionada',
          );
        data.careerId = curriculum.career.id;
      }
      if (input.careerId) {
        const career = await tx.career.findUnique({
          where: { id: input.careerId },
          select: { id: true, isActive: true },
        });
        if (!career)
          throw new BadRequestException('La carrera seleccionada no existe');
        if (!career.isActive && career.id !== existingStudent?.careerId)
          throw new BadRequestException(
            'La carrera seleccionada está inactiva',
          );
      }
      const effectiveCareerId =
        input.careerId ?? data.careerId ?? existingStudent?.careerId;
      if (effectiveCareerId && input.admission) {
        data.careerId = effectiveCareerId;
        const cohortYear = Number(input.admission.slice(0, 4));
        const cohort = await tx.curriculumCohort.findUnique({
          where: {
            careerId_cohortYear: { careerId: effectiveCareerId, cohortYear },
          },
          select: { curriculumVersionId: true },
        });
        data.careerCurriculumVersionId = cohort?.curriculumVersionId ?? null;
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
          career: { select: { id: true, code: true, name: true } },
        },
      });
    });
  }

  async progress(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: {
        career: { select: { id: true, code: true, name: true } },
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
        career: student.career,
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
      const isRoster = rows.some((row) => row.nrcs.length > 0);
      if (isRoster && !input.semesterId)
        throw new BadRequestException(
          'Indica el semestre para importar matrículas',
        );
      const catalog = isRoster
        ? await this.catalog(tx, input.semesterId!)
        : null;
      // Validate the whole file before the first write: failures never leave partial rosters.
      const validated = rows.map((row) => ({
        ...row,
        courses: catalog ? this.offerings(catalog, row.nrcs, row.line) : [],
      }));
      const careers = rows.some(({ registry }) => registry)
        ? await tx.career.findMany({
            select: { id: true, code: true, name: true },
          })
        : [];
      const normalizeCareer = (value: string) =>
        value
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLocaleLowerCase('es');
      const careerFor = (row: (typeof validated)[number]) => {
        const byCode = row.careerCode
          ? careers.find(
              (career) =>
                career.code?.trim().toLowerCase() ===
                row.careerCode!.toLowerCase(),
            )
          : undefined;
        return (
          byCode ??
          (row.careerName
            ? careers.find(
                (career) =>
                  normalizeCareer(career.name) ===
                  normalizeCareer(row.careerName!),
              )
            : undefined)
        );
      };
      const existing = await tx.student.findMany({
        where: { email: { in: rows.map(({ email }) => email) } },
        select: { id: true, email: true, name: true },
      });
      await tx.student.createMany({
        data: validated.map((row) => {
          const career = careerFor(row);
          return {
            name: row.registry
              ? [row.name, row.paternalSurname, row.maternalSurname]
                  .filter(Boolean)
                  .join(' ')
              : row.name,
            email: row.email,
            ...(row.registry ? { givenNames: row.name } : {}),
            ...(row.personalEmail ? { personalEmail: row.personalEmail } : {}),
            ...(row.rut ? { rut: row.rut } : {}),
            ...(row.admission ? { admission: row.admission } : {}),
            ...(row.paternalSurname
              ? { paternalSurname: row.paternalSurname }
              : {}),
            ...(row.maternalSurname
              ? { maternalSurname: row.maternalSurname }
              : {}),
            ...(row.birthDate ? { birthDate: row.birthDate } : {}),
            ...(career ? { careerId: career.id } : {}),
          };
        }),
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
      const links = catalog
        ? await tx.studentEnrollment.createMany({
            data: validated.flatMap((row) =>
              row.courses.map((course) => ({
                studentId: byEmail.get(row.email)!,
                semesterId: input.semesterId!,
                courseId: course.courseId,
                nrc: course.nrc,
              })),
            ),
            skipDuplicates: true,
          })
        : { count: 0 };
      for (const row of validated.filter(({ registry }) => registry)) {
        const studentId = byEmail.get(row.email);
        if (!studentId) continue;
        const career = careerFor(row);
        const cohort =
          career && row.admission
            ? await tx.curriculumCohort.findUnique({
                where: {
                  careerId_cohortYear: {
                    careerId: career.id,
                    cohortYear: Number(row.admission.slice(0, 4)),
                  },
                },
                select: { curriculumVersionId: true },
              })
            : null;
        await tx.student.update({
          where: { id: studentId },
          data: {
            name: [row.name, row.paternalSurname, row.maternalSurname]
              .filter(Boolean)
              .join(' '),
            givenNames: row.name,
            rut: row.rut ?? null,
            personalEmail: row.personalEmail ?? null,
            admission: row.admission ?? null,
            paternalSurname: row.paternalSurname ?? null,
            maternalSurname: row.maternalSurname ?? null,
            birthDate: row.birthDate ?? null,
            careerId: career?.id ?? null,
            careerCurriculumVersionId: cohort?.curriculumVersionId ?? null,
          },
        });
      }
      return {
        importedStudents: rows.length,
        createdStudents: students.length - existing.length,
        addedEnrollments: links.count,
        semesterId: input.semesterId ?? null,
      };
    });
  }
}
