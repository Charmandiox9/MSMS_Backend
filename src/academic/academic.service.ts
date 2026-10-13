import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { isEmail } from 'class-validator';
import { AssistantshipState } from '../assistantships/assistantships.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ListTeachersQueryDto } from './list-teachers-query.dto';
import { CreateTeacherDto } from './create-teacher.dto';
import { UpdateTeacherDto } from './update-teacher.dto';
import { academicScheduleBlocks } from './schedule-blocks';
import { academicScheduleDays, UpdateCourseDto } from './update-course.dto';

interface TeacherImportRow {
  line: number;
  teacherEmail: string;
  teacherName: string;
  courseCode?: string;
  courseName: string;
  nrc: string;
  semesterName: string;
  startsOn: string;
  endsOn: string;
  employeeCode?: string;
}

interface CourseScheduleImportRow {
  line: number;
  nrc: string;
  subjectName: string;
  day: string;
  block: string;
  location?: string;
}

const DAYS = new Map([
  ['lunes', 'Lunes'],
  ['martes', 'Martes'],
  ['miercoles', 'Miércoles'],
  ['jueves', 'Jueves'],
  ['viernes', 'Viernes'],
  ['sabado', 'Sábado'],
]);
const BLOCKS = new Set(academicScheduleBlocks.map((block) => block.code));

// Largos máximos de los campos importados (los mismos de UpdateCourseDto).
const MAX_NAME = 200;
const MAX_CODE = 50;
const MAX_SEMESTER_NAME = 100;

// Las importaciones hacen varias consultas por fila: con la base remota superan
// fácilmente los 5 s que Prisma da por defecto a una transacción interactiva.
const IMPORT_TRANSACTION = { maxWait: 10_000, timeout: 60_000 };

/** Líneas no vacías del CSV con su número en el archivo (la cabecera es la fila 1). */
const csvLines = (csv: string) =>
  csv
    .split(/\r?\n/)
    .map((text, index) => ({ line: index + 1, text: text.trim() }))
    .filter(({ text }) => text);

const rowError = (line: number, message: string) =>
  new BadRequestException(`Fila ${line}: ${message}`);

/** Rechaza valores que superan el largo máximo de su columna. */
const checkLengths = (
  line: number,
  fields: [label: string, value: string | undefined, max: number][],
) => {
  for (const [label, value, max] of fields)
    if (value && value.length > max)
      throw rowError(line, `${label} supera los ${max} caracteres`);
};

/** Correo en minúsculas, para que Ana@ucn.cl y ana@ucn.cl sean el mismo docente. */
const importedEmail = (line: number, value: string) => {
  const email = value.toLowerCase();
  if (!isEmail(email)) throw rowError(line, `Correo inválido: ${value}`);
  return email;
};

/** Minutos desde medianoche a "HH:MM". */
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// Las ayudantías guardan el día como número (1 = lunes … 7 = domingo).
const assistantshipWeekdays = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

/**
 * Día y bloque de un horario de ayudantía. El bloque solo se asigna si las horas
 * coinciden exactamente con uno institucional; si no, queda en ''.
 */
const assistantshipSlot = (schedule: {
  weekday: number;
  startsAtMinute: number;
  endsAtMinute: number;
}) => ({
  day: assistantshipWeekdays[schedule.weekday % 7],
  block:
    academicScheduleBlocks.find(
      (block) =>
        block.startsAtMinute === schedule.startsAtMinute &&
        block.endsAtMinute === schedule.endsAtMinute,
    )?.code ?? '',
});

@Injectable()
export class AcademicService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** Hoy a las 00:00 UTC según la zona horaria académica (igual que AssistantshipsService). */
  private today(): Date {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone:
        this.config?.get<string>('ACADEMIC_TIME_ZONE') ?? 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (name: string) =>
      parts.find((item) => item.type === name)!.value;
    return new Date(
      `${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`,
    );
  }

  scheduleOptions() {
    return { days: academicScheduleDays, blocks: academicScheduleBlocks };
  }

  async updateCourse(originalNrc: string, input: UpdateCourseDto) {
    if (!originalNrc.trim() || originalNrc.length > MAX_CODE)
      throw new BadRequestException('El NRC de la asignatura no es válido');
    const schedules = input.schedules.map((schedule) => ({
      day: this.normalizeDay(schedule.day),
      block: schedule.block.trim().toUpperCase(),
      location: schedule.location?.trim() || null,
    }));
    if (
      !schedules.length ||
      schedules.some((schedule) => !BLOCKS.has(schedule.block))
    )
      throw new BadRequestException(
        'Debes incluir horarios con bloques válidos',
      );
    if (
      new Set(schedules.map((schedule) => `${schedule.day}|${schedule.block}`))
        .size !== schedules.length
    )
      throw new BadRequestException('No puedes repetir el mismo día y bloque');
    const name = input.name.trim();
    const code =
      input.code === undefined ? undefined : input.code?.trim() || null;
    const nrc = input.nrc.trim();
    if (!name || !nrc)
      throw new BadRequestException('Nombre y NRC son obligatorios');
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const semester = await transaction.academicSemester.findFirst({
            where: { isActive: true },
          });
          if (!semester)
            throw new BadRequestException('No existe un semestre activo');
          const where = { semesterId: semester.id, nrc: originalNrc };
          const [existing, assignments] = await Promise.all([
            transaction.courseSchedule.findMany({
              where,
              select: { courseId: true },
            }),
            transaction.teachingAssignment.findMany({
              where,
              select: { courseId: true },
            }),
          ]);
          const courseIds = new Set(
            [...existing, ...assignments].map((item) => item.courseId),
          );
          if (!courseIds.size)
            throw new NotFoundException(
              'La asignatura no existe en el semestre activo',
            );
          if (courseIds.size !== 1)
            throw new ConflictException(
              'El NRC está asociado a varias asignaturas; revisa la carga académica',
            );
          const courseId = [...courseIds][0];
          if (nrc !== originalNrc) {
            const target = { semesterId: semester.id, nrc };
            const [schedule, assignment] = await Promise.all([
              transaction.courseSchedule.findFirst({ where: target }),
              transaction.teachingAssignment.findFirst({ where: target }),
            ]);
            if (schedule || assignment)
              throw new ConflictException(
                'El NRC ya existe en el semestre activo',
              );
          }
          await transaction.course.update({
            where: { id: courseId },
            data: { name, code },
          });
          await transaction.teachingAssignment.updateMany({
            where: { ...where, courseId },
            data: { nrc },
          });
          await transaction.courseSchedule.deleteMany({
            where: { ...where, courseId },
          });
          await transaction.courseSchedule.createMany({
            data: schedules.map((schedule) => ({
              ...schedule,
              semesterId: semester.id,
              courseId,
              nrc,
            })),
          });
          return { courseId, nrc, updatedSchedules: schedules.length };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw new ConflictException(
          'Los datos están duplicados o fueron modificados. Recarga e intenta nuevamente',
        );
      throw error;
    }
  }

  listSemesters() {
    return this.prisma.academicSemester.findMany({
      orderBy: [{ isActive: 'desc' }, { startsOn: 'desc' }],
    });
  }

  async activateSemester(
    name: string,
    startsOnValue: string,
    endsOnValue: string,
  ) {
    const semesterName = name.trim();
    if (!semesterName || semesterName.length > MAX_SEMESTER_NAME)
      throw new BadRequestException(
        `El nombre del semestre es obligatorio y admite hasta ${MAX_SEMESTER_NAME} caracteres`,
      );
    const startsOn = this.parseDate(startsOnValue);
    const endsOn = this.parseDate(endsOnValue);
    if (endsOn <= startsOn)
      throw new BadRequestException(
        'La fecha de término debe ser posterior al inicio',
      );

    return this.prisma.$transaction(async (transaction) => {
      const semester = await transaction.academicSemester.upsert({
        where: { name: semesterName },
        update: { startsOn, endsOn, isActive: true },
        create: { name: semesterName, startsOn, endsOn, isActive: true },
      });
      await transaction.academicSemester.updateMany({
        where: { id: { not: semester.id } },
        data: { isActive: false },
      });
      return semester;
    });
  }

  async listTeachers({
    page,
    pageSize,
    search,
    isActive,
  }: ListTeachersQueryDto) {
    const where: Prisma.TeacherWhereInput = {
      ...(search
        ? { id: { in: await this.findTeacherIdsMatching(search) } }
        : {}),
      ...(isActive === undefined ? {} : { isActive }),
    };
    const [total, items] = await Promise.all([
      this.prisma.teacher.count({ where }),
      this.prisma.teacher.findMany({
        where,
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          assignments: {
            where: { semester: { isActive: true } },
            include: { course: true, semester: true },
            orderBy: { course: { name: 'asc' } },
          },
        },
      }),
    ]);
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // Prisma no ofrece comparaciones sin tildes, así que los ids que coinciden se
  // buscan con unaccent + ILIKE ("alvaro" encuentra "Álvaro"). Cubre nombre,
  // correo, código y los NRC del semestre activo, que son los del listado.
  private async findTeacherIdsMatching(search: string): Promise<string[]> {
    // Los comodines que escriba el usuario (% y _) se buscan literalmente.
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT t."id"
      FROM "Teacher" t
      WHERE unaccent(t."name") ILIKE unaccent(${pattern})
        OR unaccent(t."email") ILIKE unaccent(${pattern})
        OR unaccent(COALESCE(t."employeeCode", '')) ILIKE unaccent(${pattern})
        OR EXISTS (
          SELECT 1
          FROM "TeachingAssignment" a
          JOIN "AcademicSemester" s ON s."id" = a."semesterId"
          WHERE a."teacherId" = t."id"
            AND s."isActive"
            AND a."nrc" ILIKE ${pattern}
        )`;
    return rows.map((row) => row.id);
  }

  async getTeacher(id: string) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id },
      include: {
        assignments: {
          where: { semester: { isActive: true } },
          include: { course: true, semester: true },
        },
      },
    });
    if (!teacher) throw new NotFoundException('El docente no existe');
    return teacher;
  }

  async createTeacher(dto: CreateTeacherDto) {
    const email = dto.email.trim().toLowerCase();
    const existingEmail = await this.prisma.teacher.findUnique({
      where: { email },
    });
    if (existingEmail) {
      throw new ConflictException(
        'Ya existe un docente registrado con ese correo institucional',
      );
    }

    const employeeCode = dto.employeeCode?.trim() || null;
    if (employeeCode) {
      const existingCode = await this.prisma.teacher.findUnique({
        where: { employeeCode },
      });
      if (existingCode) {
        throw new ConflictException(
          'Ya existe un docente registrado con ese código de empleado',
        );
      }
    }

    const joinedOn = dto.joinedOn ? this.parseDate(dto.joinedOn) : null;
    const academicDegree = dto.academicDegree?.trim() || null;
    const professionalTitle = dto.professionalTitle?.trim() || null;
    const institution = dto.institution?.trim() || null;

    return this.prisma.$transaction(async (transaction) => {
      const teacher = await transaction.teacher.create({
        data: {
          name: dto.name.trim(),
          email,
          employeeCode,
          joinedOn,
          academicDegree,
          professionalTitle,
          institution,
          isActive: true,
        },
        include: {
          assignments: {
            where: { semester: { isActive: true } },
            include: { course: true, semester: true },
          },
        },
      });

      if (dto.nrcs && dto.nrcs.length > 0) {
        const semester = await transaction.academicSemester.findFirst({
          where: { isActive: true },
        });
        if (semester) {
          for (const rawNrc of dto.nrcs) {
            const nrc = rawNrc.trim();
            if (!nrc) continue;
            const assignment = await transaction.teachingAssignment.findFirst({
              where: { semesterId: semester.id, nrc },
              select: { courseId: true },
            });
            const schedule = assignment
              ? null
              : await transaction.courseSchedule.findFirst({
                  where: { semesterId: semester.id, nrc },
                  select: { courseId: true },
                });
            const courseId = assignment?.courseId ?? schedule?.courseId;
            if (courseId) {
              await transaction.teachingAssignment.upsert({
                where: {
                  semesterId_teacherId_courseId_nrc: {
                    semesterId: semester.id,
                    teacherId: teacher.id,
                    courseId,
                    nrc,
                  },
                },
                update: {},
                create: {
                  semesterId: semester.id,
                  teacherId: teacher.id,
                  courseId,
                  nrc,
                  parallel: '',
                },
              });
            }
          }
          const reloaded = await transaction.teacher.findUnique({
            where: { id: teacher.id },
            include: {
              assignments: {
                where: { semester: { isActive: true } },
                include: { course: true, semester: true },
              },
            },
          });
          if (reloaded) return reloaded;
        }
      }

      return teacher;
    });
  }

  async updateTeacher(id: string, dto: UpdateTeacherDto) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id },
    });
    if (!teacher) {
      throw new NotFoundException('El docente no existe');
    }

    const data: Prisma.TeacherUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== teacher.email) {
        const existingEmail = await this.prisma.teacher.findUnique({
          where: { email },
        });
        if (existingEmail) {
          throw new ConflictException(
            'Ya existe un docente registrado con ese correo institucional',
          );
        }
        data.email = email;
      }
    }

    if (dto.employeeCode !== undefined) {
      const employeeCode = dto.employeeCode.trim() || null;
      if (employeeCode !== teacher.employeeCode && employeeCode !== null) {
        const existingCode = await this.prisma.teacher.findUnique({
          where: { employeeCode },
        });
        if (existingCode) {
          throw new ConflictException(
            'Ya existe un docente registrado con ese código de empleado',
          );
        }
      }
      data.employeeCode = employeeCode;
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
      if (dto.isActive === false && teacher.isActive) {
        data.leftOn = dto.leftOn ? this.parseDate(dto.leftOn) : new Date();
      } else if (dto.isActive === true && !teacher.isActive) {
        data.leftOn = null;
      }
    }

    if (dto.joinedOn !== undefined) {
      data.joinedOn = dto.joinedOn ? this.parseDate(dto.joinedOn) : null;
    }

    if (dto.leftOn !== undefined && dto.isActive === undefined) {
      data.leftOn = dto.leftOn ? this.parseDate(dto.leftOn) : null;
    }

    if (dto.academicDegree !== undefined) {
      data.academicDegree = dto.academicDegree.trim() || null;
    }

    if (dto.professionalTitle !== undefined) {
      data.professionalTitle = dto.professionalTitle.trim() || null;
    }

    if (dto.institution !== undefined) {
      data.institution = dto.institution.trim() || null;
    }

    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.teacher.update({
        where: { id },
        data,
        include: {
          assignments: {
            where: { semester: { isActive: true } },
            include: { course: true, semester: true },
          },
        },
      });

      if (dto.nrcs !== undefined) {
        const semester = await transaction.academicSemester.findFirst({
          where: { isActive: true },
        });
        if (semester) {
          const currentAssignments =
            await transaction.teachingAssignment.findMany({
              where: { teacherId: id, semesterId: semester.id },
            });
          const targetNrcs = new Set(
            dto.nrcs.map((n) => n.trim()).filter(Boolean),
          );

          for (const current of currentAssignments) {
            if (!targetNrcs.has(current.nrc)) {
              await transaction.teachingAssignment.delete({
                where: { id: current.id },
              });
            }
          }

          for (const nrc of targetNrcs) {
            const exists = currentAssignments.some((a) => a.nrc === nrc);
            if (!exists) {
              const assignment =
                await transaction.teachingAssignment.findFirst({
                  where: { semesterId: semester.id, nrc },
                  select: { courseId: true },
                });
              const schedule = assignment
                ? null
                : await transaction.courseSchedule.findFirst({
                    where: { semesterId: semester.id, nrc },
                    select: { courseId: true },
                  });
              const courseId = assignment?.courseId ?? schedule?.courseId;
              if (courseId) {
                await transaction.teachingAssignment.upsert({
                  where: {
                    semesterId_teacherId_courseId_nrc: {
                      semesterId: semester.id,
                      teacherId: id,
                      courseId,
                      nrc,
                    },
                  },
                  update: {},
                  create: {
                    semesterId: semester.id,
                    teacherId: id,
                    courseId,
                    nrc,
                    parallel: '',
                  },
                });
              }
            }
          }

          const reloaded = await transaction.teacher.findUnique({
            where: { id },
            include: {
              assignments: {
                where: { semester: { isActive: true } },
                include: { course: true, semester: true },
              },
            },
          });
          if (reloaded) return reloaded;
        }
      }

      return updated;
    });
  }

  async toggleTeacherStatus(id: string, isActive: boolean) {
    return this.updateTeacher(id, { isActive });
  }

  /**
   * Horario semanal del docente en el semestre activo, con el mismo criterio que
   * la vista de asignaturas: clases cruzando sus NRC con los horarios de curso y
   * ayudantías de sus asignaciones del semestre. `conflict` marca solo choques
   * entre clases del docente; una ayudantía en el mismo bloque es normal.
   */
  async getTeacherSchedule(id: string) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id },
      select: { id: true, name: true, email: true },
    });
    if (!teacher) throw new NotFoundException('El docente no existe');

    const blocks = academicScheduleBlocks.map((block) => ({
      code: block.code,
      startsAt: clock(block.startsAtMinute),
      endsAt: clock(block.endsAtMinute),
    }));
    const semester = await this.prisma.academicSemester.findFirst({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    if (!semester) return { teacher, semester: null, blocks, entries: [] };

    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { teacherId: id, semesterId: semester.id },
      select: { nrc: true },
    });
    const nrcs = [
      ...new Set(assignments.map(({ nrc }) => nrc).filter(Boolean)),
    ];
    const schedules = nrcs.length
      ? await this.prisma.courseSchedule.findMany({
          where: { semesterId: semester.id, nrc: { in: nrcs } },
          include: { course: true },
        })
      : [];
    const assistantships = await this.prisma.assistantship.findMany({
      where: { teachingAssignment: { teacherId: id, semesterId: semester.id } },
      include: {
        teachingAssignment: { include: { course: true } },
        approval: { include: { assistant: true } },
        schedules: true,
      },
    });

    const slots = new Map<string, number>();
    for (const { day, block } of schedules) {
      const key = `${day}|${block}`;
      slots.set(key, (slots.get(key) ?? 0) + 1);
    }
    const courseOf = (course: {
      id: string;
      code: string | null;
      name: string;
    }) => ({ id: course.id, code: course.code, name: course.name });

    const classes = schedules.map((schedule) => {
      const block = blocks.find(({ code }) => code === schedule.block);
      return {
        id: schedule.id,
        kind: 'COURSE' as const,
        day: schedule.day,
        block: schedule.block,
        startsAt: block?.startsAt ?? null,
        endsAt: block?.endsAt ?? null,
        nrc: schedule.nrc,
        assistantshipNrc: null,
        course: courseOf(schedule.course),
        location: schedule.location,
        assistant: null,
        state: null,
        conflict: (slots.get(`${schedule.day}|${schedule.block}`) ?? 0) > 1,
      };
    });
    // Mismo criterio que AssistantshipsService: por empezar, vigente o terminada.
    const today = this.today();
    const stateOf = (item: { startsOn: Date; endsOn: Date | null }) =>
      item.startsOn > today
        ? AssistantshipState.SCHEDULED
        : item.endsOn && item.endsOn < today
          ? AssistantshipState.COMPLETED
          : AssistantshipState.ACTIVE;
    // Las ayudantías llevan su hora real aunque no calce con un bloque (block '').
    const assistantshipEntries = assistantships.flatMap((item) =>
      item.schedules.map((schedule) => ({
        id: schedule.id,
        kind: 'ASSISTANTSHIP' as const,
        ...assistantshipSlot(schedule),
        startsAt: clock(schedule.startsAtMinute),
        endsAt: clock(schedule.endsAtMinute),
        nrc: item.teachingAssignment.nrc,
        assistantshipNrc: item.nrc,
        course: courseOf(item.teachingAssignment.course),
        location: schedule.location,
        assistant: {
          id: item.approval.assistant.id,
          name: item.approval.assistant.name,
          email: item.approval.assistant.email,
        },
        state: stateOf(item),
        conflict: false,
      })),
    );

    // Orden: día, hora de inicio, clases antes que ayudantías y NRC. Días y
    // bloques desconocidos (datos antiguos) van al final y sin hora.
    const dayPosition = (day: string) => {
      const index = academicScheduleDays.indexOf(day);
      return index === -1 ? academicScheduleDays.length : index;
    };
    const kindPosition = (kind: 'COURSE' | 'ASSISTANTSHIP') =>
      kind === 'COURSE' ? 0 : 1;
    const entries = [...classes, ...assistantshipEntries].sort(
      (a, b) =>
        dayPosition(a.day) - dayPosition(b.day) ||
        (a.startsAt ?? '99:99').localeCompare(b.startsAt ?? '99:99') ||
        kindPosition(a.kind) - kindPosition(b.kind) ||
        a.nrc.localeCompare(b.nrc),
    );

    return { teacher, semester, blocks, entries };
  }

  async importCsv(csv: string) {
    const rows = this.parseCsv(csv);
    if (rows.length === 0)
      throw new BadRequestException('El CSV no contiene filas');

    return this.prisma.$transaction(async (transaction) => {
      const first = rows[0];
      const startsOn = this.parseDate(first.startsOn);
      const endsOn = this.parseDate(first.endsOn);
      const semester = await transaction.academicSemester.upsert({
        where: { name: first.semesterName },
        update: { startsOn, endsOn, isActive: true },
        create: { name: first.semesterName, startsOn, endsOn, isActive: true },
      });
      await transaction.academicSemester.updateMany({
        where: { id: { not: semester.id } },
        data: { isActive: false },
      });

      for (const row of rows) {
        const teacher = await this.upsertTeacher(
          transaction,
          row.teacherEmail,
          {
            name: row.teacherName,
            // Vacío no se guarda: employeeCode es único y '' chocaría entre docentes.
            employeeCode: row.employeeCode || undefined,
          },
        );
        const course = await this.resolveImportedCourse(
          transaction,
          semester.id,
          row.nrc,
          row.courseName,
          row.courseCode,
        );
        await transaction.teachingAssignment.upsert({
          where: {
            semesterId_teacherId_courseId_nrc: {
              semesterId: semester.id,
              teacherId: teacher.id,
              courseId: course.id,
              nrc: row.nrc,
            },
          },
          update: { parallel: '' },
          create: {
            semesterId: semester.id,
            teacherId: teacher.id,
            courseId: course.id,
            nrc: row.nrc,
            parallel: '',
          },
        });
      }

      return { semesterId: semester.id, importedRows: rows.length };
    }, IMPORT_TRANSACTION);
  }

  async importTeacherRoster(csv: string) {
    const lines = csvLines(csv);
    if (lines.length < 2)
      throw new BadRequestException('El CSV de profesores no contiene filas');

    const headers = this.splitCsvLine(lines[0].text).map((header) =>
      this.normalizeHeader(header),
    );
    const nameIndex = headers.findIndex((header) =>
      ['nombre', 'name', 'teachername'].includes(header),
    );
    const emailIndex = headers.findIndex((header) =>
      ['correo', 'email', 'teacheremail'].includes(header),
    );
    if (nameIndex < 0 || emailIndex < 0 || headers.length < 3) {
      throw new BadRequestException(
        'El CSV debe incluir nombre, correo y al menos una columna de NRC',
      );
    }

    const rows = lines.slice(1).map(({ line, text }) => {
      const values = this.splitCsvLine(text).map((value) => value.trim());
      const nrcs = values
        .filter(
          (value, index) =>
            index !== nameIndex && index !== emailIndex && value,
        )
        .flatMap((value) =>
          value
            .split(/[|,]/)
            .map((nrc) => nrc.trim())
            .filter(Boolean),
        );
      if (!values[nameIndex] || !values[emailIndex] || nrcs.length === 0)
        throw rowError(line, 'Hay una fila incompleta en el CSV de profesores');
      checkLengths(line, [
        ['El nombre', values[nameIndex], MAX_NAME],
        ...nrcs.map((nrc): [string, string, number] => [
          'El NRC',
          nrc,
          MAX_CODE,
        ]),
      ]);
      return {
        line,
        name: values[nameIndex],
        email: importedEmail(line, values[emailIndex]),
        nrcs: [...new Set(nrcs)],
      };
    });

    return this.prisma.$transaction(async (transaction) => {
      const semester = await transaction.academicSemester.findFirst({
        where: { isActive: true },
      });
      if (!semester)
        throw new BadRequestException(
          'No existe un semestre activo. Importa primero la carga académica o crea el semestre.',
        );

      let importedAssignments = 0;
      for (const row of rows) {
        const teacher = await this.upsertTeacher(transaction, row.email, {
          name: row.name,
        });
        for (const nrc of row.nrcs) {
          const assignment = await transaction.teachingAssignment.findFirst({
            where: { semesterId: semester.id, nrc },
            select: { courseId: true },
          });
          const schedule = assignment
            ? null
            : await transaction.courseSchedule.findFirst({
                where: { semesterId: semester.id, nrc },
                select: { courseId: true },
              });
          const courseId = assignment?.courseId ?? schedule?.courseId;
          if (!courseId)
            throw rowError(
              row.line,
              `El NRC ${nrc} no está cargado en el semestre activo`,
            );
          await transaction.teachingAssignment.upsert({
            where: {
              semesterId_teacherId_courseId_nrc: {
                semesterId: semester.id,
                teacherId: teacher.id,
                courseId,
                nrc,
              },
            },
            update: {},
            create: {
              semesterId: semester.id,
              teacherId: teacher.id,
              courseId,
              nrc,
              parallel: '',
            },
          });
          importedAssignments += 1;
        }
      }
      return {
        semesterId: semester.id,
        importedTeachers: rows.length,
        importedAssignments,
      };
    }, IMPORT_TRANSACTION);
  }

  async listCourseSchedules() {
    const [courses, assistantships] = await Promise.all([
      this.prisma.courseSchedule.findMany({
        where: { semester: { isActive: true } },
        orderBy: [
          { day: 'asc' },
          { block: 'asc' },
          { course: { name: 'asc' } },
        ],
        include: { course: true, semester: true },
      }),
      this.prisma.assistantship.findMany({
        where: { teachingAssignment: { semester: { isActive: true } } },
        include: {
          teachingAssignment: { include: { course: true, semester: true } },
          approval: { include: { assistant: true } },
          schedules: true,
        },
      }),
    ]);
    return [
      ...courses.map((course) => ({ ...course, kind: 'COURSE' })),
      ...assistantships.flatMap((item) =>
        item.schedules.map((schedule) => ({
          id: schedule.id,
          nrc: item.teachingAssignment.nrc,
          assistantshipNrc: item.nrc,
          ...assistantshipSlot(schedule),
          startsAtMinute: schedule.startsAtMinute,
          endsAtMinute: schedule.endsAtMinute,
          location: schedule.location,
          assistant: {
            name: item.approval.assistant.name,
            email: item.approval.assistant.email,
          },
          course: item.teachingAssignment.course,
          semester: item.teachingAssignment.semester,
          startsOn: item.startsOn,
          endsOn: item.endsOn,
          kind: 'ASSISTANTSHIP',
        })),
      ),
    ];
  }

  async importCourseSchedules(csv: string) {
    const rows = this.parseCourseScheduleCsv(csv);
    if (rows.length === 0)
      throw new BadRequestException('El CSV no contiene filas');

    return this.prisma.$transaction(async (transaction) => {
      const semester = await transaction.academicSemester.findFirst({
        where: { isActive: true },
      });
      if (!semester)
        throw new BadRequestException('No existe un semestre activo');

      const courseCache = new Map<string, string>();
      for (const row of rows) {
        const { day: normalizedDay, block } = row;
        let courseId = courseCache.get(`${row.nrc}|${row.subjectName}`);
        if (!courseId) {
          const assignment = await transaction.teachingAssignment.findFirst({
            where: { semesterId: semester.id, nrc: row.nrc },
            select: { courseId: true },
          });
          if (assignment) courseId = assignment.courseId;
          else {
            const course = await this.resolveImportedCourse(
              transaction,
              semester.id,
              row.nrc,
              row.subjectName,
            );
            courseId = course.id;
          }
          courseCache.set(`${row.nrc}|${row.subjectName}`, courseId);
        }

        await transaction.courseSchedule.upsert({
          where: {
            semesterId_nrc_day_block: {
              semesterId: semester.id,
              nrc: row.nrc,
              day: normalizedDay,
              block,
            },
          },
          update: {
            courseId,
            ...(row.location === undefined
              ? {}
              : { location: row.location || null }),
          },
          create: {
            semesterId: semester.id,
            courseId,
            nrc: row.nrc,
            day: normalizedDay,
            block,
            ...(row.location === undefined
              ? {}
              : { location: row.location || null }),
          },
        });
      }

      return { semesterId: semester.id, importedRows: rows.length };
    }, IMPORT_TRANSACTION);
  }

  private async resolveImportedCourse(
    transaction: Prisma.TransactionClient,
    semesterId: string,
    nrc: string,
    name: string,
    code?: string,
  ) {
    if (code?.trim())
      return transaction.course.upsert({
        where: { code_name: { code: code.trim(), name } },
        update: {},
        create: { code: code.trim(), name },
        select: { id: true },
      });
    const assignment = await transaction.teachingAssignment.findFirst({
      where: { semesterId, nrc },
      select: { courseId: true },
    });
    const schedule = assignment
      ? null
      : await transaction.courseSchedule.findFirst({
          where: { semesterId, nrc },
          select: { courseId: true },
        });
    const courseId = assignment?.courseId ?? schedule?.courseId;
    if (courseId) return { id: courseId };
    const existing = await transaction.course.findFirst({
      where: { code: null, name },
      select: { id: true },
    });
    return (
      existing ??
      transaction.course.create({
        data: { code: null, name },
        select: { id: true },
      })
    );
  }

  private parseCsv(csv: string): TeacherImportRow[] {
    const lines = csvLines(csv);
    if (lines.length < 2) return [];
    const headers = this.splitCsvLine(lines[0].text).map((header) =>
      header.trim(),
    );
    const required = [
      'teacherEmail',
      'teacherName',
      'courseName',
      'nrc',
      'semesterName',
      'startsOn',
      'endsOn',
    ];
    for (const key of required)
      if (!headers.includes(key))
        throw new BadRequestException(`Falta la columna ${key}`);
    const rows = lines.slice(1).map(({ line, text }) => {
      const values = this.splitCsvLine(text);
      const row = Object.fromEntries(
        headers.map((header, index) => [header, values[index]?.trim() ?? '']),
      ) as Partial<TeacherImportRow>;
      if (
        !row.teacherEmail ||
        !row.teacherName ||
        !row.courseName ||
        !row.nrc ||
        !row.semesterName
      )
        throw rowError(line, 'Hay una fila incompleta en el CSV');
      checkLengths(line, [
        ['El nombre del docente', row.teacherName, MAX_NAME],
        ['El código de funcionario', row.employeeCode, MAX_CODE],
        ['La asignatura', row.courseName, MAX_NAME],
        ['El código de asignatura', row.courseCode, MAX_CODE],
        ['El NRC', row.nrc, MAX_CODE],
        ['El semestre', row.semesterName, MAX_SEMESTER_NAME],
      ]);
      return {
        ...row,
        line,
        teacherEmail: importedEmail(line, row.teacherEmail),
      } as TeacherImportRow;
    });

    // La importación activa un único semestre: todas las filas deben describirlo igual.
    const [first, ...rest] = rows;
    const startsOn = this.rowDate(first.line, first.startsOn);
    const endsOn = this.rowDate(first.line, first.endsOn);
    if (endsOn <= startsOn)
      throw rowError(
        first.line,
        'La fecha de término debe ser posterior al inicio',
      );
    for (const row of rest)
      if (
        row.semesterName !== first.semesterName ||
        this.rowDate(row.line, row.startsOn).getTime() !== startsOn.getTime() ||
        this.rowDate(row.line, row.endsOn).getTime() !== endsOn.getTime()
      )
        throw rowError(
          row.line,
          `Todas las filas deben ser del semestre ${first.semesterName} (${first.startsOn} a ${first.endsOn})`,
        );
    return rows;
  }

  private splitCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let quoted = false;
    for (const character of line) {
      if (character === '"') quoted = !quoted;
      else if ((character === ',' || character === ';') && !quoted) {
        values.push(current);
        current = '';
      } else current += character;
    }
    values.push(current);
    return values;
  }

  private parseCourseScheduleCsv(csv: string): CourseScheduleImportRow[] {
    const lines = csvLines(csv);
    if (lines.length < 2) return [];
    const headers = this.splitCsvLine(lines[0].text).map((header) =>
      this.normalizeHeader(header),
    );
    const required = ['nrc', 'asignatura', 'dia', 'bloque'];
    for (const key of required)
      if (!headers.includes(key))
        throw new BadRequestException(`Falta la columna ${key}`);
    return lines.slice(1).map(({ line, text }) => {
      const values = this.splitCsvLine(text);
      const row = Object.fromEntries(
        headers.map((header, index) => [header, values[index]?.trim() ?? '']),
      );
      if (!row.nrc || !row.asignatura || !row.dia || !row.bloque)
        throw rowError(
          line,
          'Hay una fila incompleta en el CSV de asignaturas',
        );
      const day = DAYS.get(this.normalizeHeader(row.dia));
      if (!day) throw rowError(line, `Día inválido: ${row.dia}`);
      const block = row.bloque.toUpperCase();
      if (!BLOCKS.has(block))
        throw rowError(line, `Bloque inválido: ${row.bloque}`);
      const location = row.sala ?? row.location ?? row.room;
      checkLengths(line, [
        ['El NRC', row.nrc, MAX_CODE],
        ['La asignatura', row.asignatura, MAX_NAME],
        ['La sala', location, MAX_NAME],
      ]);
      return {
        line,
        nrc: row.nrc,
        subjectName: row.asignatura,
        day,
        block,
        location,
      };
    });
  }

  private normalizeHeader(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private normalizeDay(value: string): string {
    const normalized = this.normalizeHeader(value);
    const day = DAYS.get(normalized);
    if (!day) throw new BadRequestException(`Día inválido: ${value}`);
    return day;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new BadRequestException(`Fecha inválida: ${value}`);
    return date;
  }

  private rowDate(line: number, value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw rowError(line, `Fecha inválida: ${value}`);
    return date;
  }

  /**
   * Crea o actualiza al docente por correo. Busca sin distinguir mayúsculas para
   * reutilizar docentes guardados antes de normalizar los correos.
   */
  private async upsertTeacher(
    transaction: Prisma.TransactionClient,
    email: string,
    data: { name: string; employeeCode?: string },
  ) {
    const existing = await transaction.teacher.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { email: true },
    });
    return transaction.teacher.upsert({
      where: { email: existing?.email ?? email },
      update: data,
      create: { email, ...data },
    });
  }
}
