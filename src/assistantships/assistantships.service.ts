import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { academicScheduleBlocks } from '../academic/schedule-blocks';
import {
  AssistantshipFilters,
  AssistantshipState,
  AssistantshipView,
  RegisterAssistantshipInput,
  SaveAssistantshipTariffInput,
} from './assistantships.dto';
import { SemesterBudgetsService } from '../semester-budgets/semester-budgets.service';
import { NotificationsService } from '../notifications/notifications.service';
const include = {
  approval: {
    include: {
      assistant: {
        include: {
          student: {
            include: { careerCurriculumVersion: { include: { career: true } } },
          },
        },
      },
    },
  },
  course: true,
  semester: true,
  career: true,
  teachingAssignment: {
    include: { teacher: true, course: true, semester: true },
  },
  schedules: { orderBy: [{ weekday: 'asc' }, { startsAtMinute: 'asc' }] },
  tariff: true,
} satisfies Prisma.AssistantshipInclude;
type AssistantshipRecord = Prisma.AssistantshipGetPayload<{
  include: typeof include;
}>;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const invalid = (code: string, message: string): never => {
  throw new BadRequestException({ code, message });
};
@Injectable()
export class AssistantshipsService {
  private readonly logger = new Logger(AssistantshipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly semesterBudgets: SemesterBudgetsService,
    private readonly notifications: NotificationsService,
  ) {}
  private today(): Date {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone:
        this.config.get<string>('ACADEMIC_TIME_ZONE') ?? 'America/Santiago',
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
  private view(record: AssistantshipRecord, today: Date): AssistantshipView {
    const {
      teachingAssignment: assignment,
      approval: { assistant },
    } = record;
    return {
      id: record.id,
      teachingAssignmentId: record.teachingAssignmentId,
      assistantshipNrc: record.nrc,
      studentId: assistant.studentId,
      courseId: record.courseId,
      careerId: record.careerId,
      careerName: record.career?.name ?? null,
      careerCurriculumVersionId:
        assistant.student?.careerCurriculumVersionId ?? null,
      assistantName: assistant.student?.name ?? assistant.name,
      assistantEmail: assistant.student?.email ?? assistant.email,
      studentCode: assistant.studentCode,
      courseName: record.course.name,
      courseCode: record.course.code,
      nrc: record.courseNrc ?? assignment?.nrc ?? null,
      teacherName: assignment?.teacher.name ?? null,
      semesterId: record.semesterId,
      semesterName: record.semester.name,
      approvedOn: isoDate(record.approvedOn),
      startsOn: isoDate(record.startsOn),
      endsOn: record.endsOn ? isoDate(record.endsOn) : null,
      weeklyHours: record.weeklyHours?.toNumber() ?? null,
      tariffId: record.tariffId,
      tariffName: record.tariff?.name ?? null,
      tariffRateClp: record.tariffRateClp?.toNumber() ?? null,
      estimatedAmountClp:
        record.weeklyHours && record.tariffRateClp
          ? record.tariffRateClp
              .mul(record.weeklyHours)
              .mul(
                Math.max(
                  0,
                  Math.floor(
                    ((record.endsOn ?? record.semester.endsOn).getTime() -
                      record.startsOn.getTime()) /
                      86_400_000,
                  ) + 1,
                ),
              )
              .div(30)
              .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
              .toNumber()
          : null,
      schedules: record.schedules,
      state:
        record.startsOn > today
          ? AssistantshipState.SCHEDULED
          : record.endsOn && record.endsOn < today
            ? AssistantshipState.COMPLETED
            : AssistantshipState.ACTIVE,
    };
  }
  async list(filters: AssistantshipFilters) {
    const today = this.today();
    const search = filters.search?.trim();
    const text = { contains: search, mode: 'insensitive' as const };
    const assistantIds = search
      ? await this.prisma.findPiiIds('TeachingAssistant', search)
      : [];
    const teacherIds = search
      ? await this.prisma.findPiiIds('Teacher', search)
      : [];
    const studentIds = search
      ? await this.prisma.findPiiIds('Student', search, undefined, 'exclude')
      : [];
    const where: Prisma.AssistantshipWhereInput = {
      ...(filters.semesterId ? { semesterId: filters.semesterId } : {}),
      ...(filters.teacherId
        ? { teachingAssignment: { teacherId: filters.teacherId } }
        : {}),
      ...(filters.state === AssistantshipState.SCHEDULED
        ? { startsOn: { gt: today } }
        : {}),
      ...(filters.state === AssistantshipState.COMPLETED
        ? { endsOn: { lt: today } }
        : {}),
      ...(filters.state === AssistantshipState.ACTIVE
        ? {
            startsOn: { lte: today },
            AND: [{ OR: [{ endsOn: null }, { endsOn: { gte: today } }] }],
          }
        : {}),
      ...(search
        ? {
            OR: [
              {
                approval: {
                  assistant: {
                    OR: [
                      { id: { in: assistantIds } },
                      { studentId: { in: studentIds } },
                    ],
                  },
                },
              },
              {
                teachingAssignment: {
                  OR: [
                    { nrc: text },
                    { course: { OR: [{ name: text }, { code: text }] } },
                    { teacherId: { in: teacherIds } },
                  ],
                },
              },
              { nrc: text },
              { courseNrc: text },
              { course: { OR: [{ name: text }, { code: text }] } },
            ],
          }
        : {}),
    };
    const [total, assistants, semesters] = await Promise.all([
      this.prisma.assistantship.count({ where }),
      this.prisma.assistantship.groupBy({ by: ['assistantId'], where }),
      this.prisma.assistantship.findMany({
        where,
        distinct: ['semesterId'],
        select: { semesterId: true },
      }),
    ]);
    const totalPages = Math.ceil(total / filters.pageSize);
    const page = Math.min(filters.page, Math.max(1, totalPages));
    const items = await this.prisma.assistantship.findMany({
      where,
      include,
      skip: (page - 1) * filters.pageSize,
      take: filters.pageSize,
      orderBy: [
        { semester: { startsOn: 'desc' } },
        { startsOn: 'desc' },
        { id: 'asc' },
      ],
    });
    return {
      items: items.map((record) => this.view(record, today)),
      total,
      assistants: assistants.length,
      semesters: semesters.length,
      page,
      totalPages,
    };
  }
  async get(id: string): Promise<AssistantshipView> {
    const today = this.today();
    const record = await this.prisma.assistantship.findUnique({
      where: { id },
      include,
    });
    if (!record) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Ayudantía no encontrada',
      });
    }
    return this.view(record, today);
  }
  async options() {
    const [semesters, teachers, careers] = await Promise.all([
      this.prisma.academicSemester.findMany({
        orderBy: [{ startsOn: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.teacher.findMany({
        where: { assignments: { some: {} } },
        orderBy: { id: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.career.findMany({
        include: { curriculumVersions: { orderBy: { cohortYear: 'desc' } } },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      careers,
      semesters: semesters.map((semester) => ({
        ...semester,
        startsOn: isoDate(semester.startsOn),
        endsOn: isoDate(semester.endsOn),
      })),
      teachers: teachers.sort((a, b) => a.name.localeCompare(b.name, 'es')),
      blocks: academicScheduleBlocks,
    };
  }
  async tariffs(semesterId: string) {
    const semester = await this.prisma.academicSemester.findUnique({
      where: { id: semesterId },
      select: { id: true },
    });
    if (!semester) throw new NotFoundException('Semestre no encontrado');
    const tariffs = await this.prisma.assistantshipTariff.findMany({
      where: { semesterId },
      orderBy: { name: 'asc' },
    });
    return tariffs.map((tariff) => ({
      ...tariff,
      monthlyRateClp: tariff.monthlyRateClp.toNumber(),
    }));
  }
  async budgetSummary(semesterId: string) {
    return this.semesterBudgets.assistantshipSummary(semesterId);
  }
  async saveTariff(input: SaveAssistantshipTariffInput) {
    const semester = await this.prisma.academicSemester.findUnique({
      where: { id: input.semesterId },
      select: { id: true },
    });
    if (!semester) throw new NotFoundException('Semestre no encontrado');
    const duplicate = await this.prisma.assistantshipTariff.findFirst({
      where: {
        semesterId: input.semesterId,
        name: { equals: input.name.trim(), mode: 'insensitive' },
        ...(input.id ? { id: { not: input.id } } : {}),
      },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException(
        'Ya existe una tarifa con ese nombre en el semestre',
      );
    try {
      if (input.id) {
        const current = await this.prisma.assistantshipTariff.findFirst({
          where: { id: input.id, semesterId: input.semesterId },
          select: { id: true },
        });
        if (!current)
          throw new NotFoundException('Tarifa no encontrada para el semestre');
        const tariff = await this.prisma.assistantshipTariff.update({
          where: { id: input.id },
          data: {
            name: input.name.trim(),
            monthlyRateClp: new Prisma.Decimal(input.monthlyRateClp),
          },
        });
        return { ...tariff, monthlyRateClp: tariff.monthlyRateClp.toNumber() };
      }
      const tariff = await this.prisma.assistantshipTariff.create({
        data: {
          semesterId: input.semesterId,
          name: input.name.trim(),
          monthlyRateClp: new Prisma.Decimal(input.monthlyRateClp),
        },
      });
      return { ...tariff, monthlyRateClp: tariff.monthlyRateClp.toNumber() };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Ya existe una tarifa con ese nombre en el semestre',
        );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('No se pudo guardar la tarifa');
    }
  }
  async deleteTariff(id: string) {
    const [tariff, usageCount] = await Promise.all([
      this.prisma.assistantshipTariff.findUnique({
        where: { id },
        select: { id: true },
      }),
      this.prisma.assistantship.count({ where: { tariffId: id } }),
    ]);
    if (!tariff) throw new NotFoundException('Tarifa no encontrada');
    if (usageCount > 0)
      throw new ConflictException(
        'No se puede quitar una tarifa que ya está asignada a ayudantías',
      );
    try {
      await this.prisma.assistantshipTariff.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      )
        throw new ConflictException(
          'No se puede quitar una tarifa que ya está asignada a ayudantías',
        );
      throw new InternalServerErrorException('No se pudo eliminar la tarifa');
    }
    return true;
  }
  async assignments(semesterId: string) {
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { semesterId, teacher: { isActive: true }, nrc: { not: '' } },
      include: { teacher: true, course: true },
      orderBy: [{ course: { name: 'asc' } }, { nrc: 'asc' }],
    });
    return assignments.map((assignment) => ({
      id: assignment.id,
      courseName: assignment.course.name,
      courseCode: assignment.course.code,
      nrc: assignment.nrc,
      teacherName: assignment.teacher.name,
    }));
  }
  async students(search: string) {
    const term = search.trim();
    if (term.length < 2) return [];
    const ids = await this.prisma.findPiiIds(
      'Student',
      term,
      [
        'name',
        'givenNames',
        'paternalSurname',
        'maternalSurname',
        'email',
        'personalEmail',
        'rut',
      ],
      'exact',
    );
    if (!ids.length) return [];
    const students = await this.prisma.student.findMany({
      where: { id: { in: ids } },
      include: {
        career: { select: { id: true, name: true } },
        careerCurriculumVersion: {
          include: { career: { select: { id: true, name: true } } },
        },
      },
    });
    const fullName = (student: (typeof students)[number]) =>
      [student.givenNames, student.paternalSurname, student.maternalSurname]
        .filter(Boolean)
        .join(' ') || student.name;
    return students
      .sort((left, right) =>
        fullName(left).localeCompare(fullName(right), 'es', {
          sensitivity: 'base',
        }),
      )
      .slice(0, 20)
      .map((student) => ({
        id: student.id,
        name: fullName(student),
        email: student.email,
        rut: student.rut,
        careerCurriculumVersionId: student.careerCurriculumVersionId,
        careerId:
          student.careerId ?? student.careerCurriculumVersion?.careerId ?? null,
        careerName:
          student.career?.name ??
          student.careerCurriculumVersion?.career.name ??
          null,
      }));
  }
  async careerCourses(careerId: string) {
    return this.prisma.course.findMany({
      where: {
        curriculumCourses: { some: { curriculumVersion: { careerId } } },
      },
      orderBy: { name: 'asc' },
    });
  }
  async register(
    input: RegisterAssistantshipInput,
  ): Promise<AssistantshipView> {
    const record = await this.save(input);
    if (!input.notifySchedule) return record;
    if (
      !this.config.get<string>('RESEND_API_KEY') ||
      !this.config.get<string>('NOTIFICATIONS_FROM')
    )
      return { ...record, scheduleNotificationSent: false };

    const dayNames = [
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
      'domingo',
    ];
    const hour = (minute: number) =>
      `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const schedule = record.schedules.map(
      ({ weekday, startsAtMinute, endsAtMinute, location }) =>
        `- ${dayNames[weekday - 1]} ${hour(startsAtMinute)}–${hour(endsAtMinute)}${location ? ` · ${location}` : ''}`,
    );
    const date = (value: string) =>
      new Intl.DateTimeFormat('es-CL', {
        dateStyle: 'long',
        timeZone: 'UTC',
      }).format(new Date(value));
    try {
      await this.notifications.send({
        to: record.assistantEmail,
        subject: 'Horario de ayudantía confirmado',
        text: [
          `Se confirmó el horario de tu ayudantía de ${record.courseName} para el semestre ${record.semesterName}.`,
          `Vigencia: ${date(record.startsOn)} al ${date(record.endsOn ?? input.endsOn)}.`,
          '',
          ...schedule,
        ].join('\n'),
      });
      return { ...record, scheduleNotificationSent: true };
    } catch {
      this.logger.warn(
        'No se pudo enviar el horario de la ayudantía registrada',
      );
      return { ...record, scheduleNotificationSent: false };
    }
  }
  async update(
    id: string,
    input: RegisterAssistantshipInput,
  ): Promise<AssistantshipView> {
    return this.save(input, id);
  }
  private async resolveAcademicContext(
    transaction: Prisma.TransactionClient,
    input: RegisterAssistantshipInput,
    startsOn: Date,
    endsOn: Date,
  ) {
    const semester = await transaction.academicSemester.findUnique({
      where: { id: input.semesterId },
    });
    if (!semester) invalid('SEMESTER_PERIOD', 'El semestre no existe');
    const activeSemester = await transaction.academicSemester.findFirst({
      where: { isActive: true },
    });
    const historical = !semester!.isActive;
    if (
      historical &&
      semester!.endsOn >= (activeSemester?.startsOn ?? this.today())
    )
      invalid(
        'SEMESTER_PERIOD',
        'Selecciona el semestre activo o uno anterior',
      );
    const assignment = input.teachingAssignmentId
      ? await transaction.teachingAssignment.findUnique({
          where: { id: input.teachingAssignmentId },
          include: { teacher: true, semester: true },
        })
      : null;
    if (!historical && !assignment)
      invalid(
        'ASSIGNMENT_NOT_FOUND',
        'Selecciona una asignatura del semestre activo',
      );
    if (input.teachingAssignmentId && !assignment)
      invalid('ASSIGNMENT_NOT_FOUND', 'La asignación docente no existe');
    if (assignment && assignment.semesterId !== semester!.id)
      invalid('SEMESTER_PERIOD', 'El semestre de la asignatura cambió');
    if (
      !historical &&
      assignment &&
      (!assignment.teacher.isActive || !assignment.nrc)
    )
      invalid(
        'INACTIVE_PROFILE',
        'El profesor debe estar activo y tener un NRC',
      );
    if (!input.assistantshipNrc.trim())
      invalid('INVALID_INPUT', 'Indica el NRC de la ayudantía');
    if (
      startsOn < new Date(isoDate(semester!.startsOn)) ||
      endsOn > new Date(isoDate(semester!.endsOn))
    )
      invalid('SEMESTER_PERIOD', 'La ayudantía debe estar dentro del semestre');
    const courseId = historical
      ? (input.courseId ?? assignment?.courseId)
      : assignment?.courseId;
    if (!courseId) invalid('ASSIGNMENT_NOT_FOUND', 'Selecciona una asignatura');
    if (assignment && assignment.courseId !== courseId)
      invalid(
        'ASSIGNMENT_NOT_FOUND',
        'La asignatura no coincide con la asignación',
      );
    if (historical) {
      if (!input.careerId)
        invalid('CAREER_REQUIRED', 'Selecciona la carrera de la ayudantía');
      const membership = await transaction.curriculumCourse.findFirst({
        where: { courseId, curriculumVersion: { careerId: input.careerId } },
      });
      if (!membership)
        invalid('COURSE_CAREER', 'La asignatura no pertenece a esa carrera');
    }
    return { semester: semester!, assignment, historical, courseId: courseId! };
  }

  private async resolveAssistant(
    transaction: Prisma.TransactionClient,
    input: RegisterAssistantshipInput,
  ) {
    const student = await transaction.student.findUnique({
      where: { id: input.studentId },
    });
    if (!student)
      invalid('STUDENT_REQUIRED', 'Selecciona un estudiante registrado');
    const email = student?.email?.trim().toLowerCase();
    if (!email)
      return invalid(
        'STUDENT_EMAIL_REQUIRED',
        'Completa el correo del alumno en su ficha antes de registrar una ayudantía',
      );
    const studentCode = input.studentCode?.trim() || null;
    const existing = await transaction.teachingAssistant.findFirst({
      where: { OR: [{ studentId: student!.id }, { email }] },
    });
    if (existing && !existing.isActive)
      invalid('INACTIVE_PROFILE', 'El estudiante ayudante está inactivo');
    if (existing?.studentId && existing.studentId !== student!.id)
      invalid(
        'ASSISTANT_IDENTITY',
        'El correo ya está vinculado a otro estudiante',
      );
    const assistant = existing
      ? await transaction.teachingAssistant.update({
          where: { id: existing.id },
          data: { studentId: student!.id, name: student!.name, email },
        })
      : await transaction.teachingAssistant.create({
          data: {
            name: student!.name,
            email,
            studentCode,
            studentId: student!.id,
          },
        });
    return assistant;
  }

  private async save(
    input: RegisterAssistantshipInput,
    id?: string,
  ): Promise<AssistantshipView> {
    const date = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return invalid('INVALID_PERIOD', 'Usa fechas sin hora');
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(parsed.valueOf()) || isoDate(parsed) !== value)
        return invalid('INVALID_PERIOD', 'Fecha inválida');
      return parsed;
    };
    const approvedOn = date(input.approvedOn),
      startsOn = date(input.startsOn),
      endsOn = date(input.endsOn);
    if (!input.studentId)
      invalid('STUDENT_REQUIRED', 'Selecciona un estudiante registrado');
    if (
      !Number.isFinite(input.weeklyHours) ||
      input.weeklyHours <= 0 ||
      input.weeklyHours > 168
    )
      invalid('INVALID_INPUT', 'Indica las horas semanales (0,01 a 168)');
    if (!input.approvalConfirmed)
      invalid(
        'APPROVAL_REQUIRED',
        'Debes confirmar la aprobación de la asignatura',
      );
    if (approvedOn >= startsOn)
      invalid(
        'APPROVAL_DATE',
        'La aprobación debe ser anterior al inicio de la ayudantía',
      );
    if (endsOn < startsOn)
      invalid('INVALID_PERIOD', 'El término no puede ser anterior al inicio');
    if ((input.schedules?.length ?? 0) > 14)
      invalid('INVALID_SCHEDULE', 'Máximo 14 horarios');
    const schedules = input.schedules ?? [];
    if (!schedules.length)
      invalid('INVALID_SCHEDULE', 'Agrega al menos un horario');
    for (const [index, schedule] of schedules.entries()) {
      if (schedule.endsAtMinute <= schedule.startsAtMinute)
        invalid(
          'INVALID_SCHEDULE',
          'El término del horario debe ser posterior al inicio',
        );
      if (
        schedules
          .slice(0, index)
          .some(
            (other) =>
              other.weekday === schedule.weekday &&
              schedule.startsAtMinute < other.endsAtMinute &&
              other.startsAtMinute < schedule.endsAtMinute,
          )
      )
        invalid('SCHEDULE_CONFLICT', 'Los horarios ingresados se superponen');
    }
    try {
      const record = await this.prisma.$transaction(
        async (transaction) => {
          const application =
            !id && input.applicationId
              ? await transaction.assistantshipApplication.findUnique({
                  where: { id: input.applicationId },
                  select: {
                    id: true,
                    status: true,
                    assistantshipId: true,
                    studentId: true,
                    studentEmail: true,
                  },
                })
              : null;
          if (
            input.applicationId &&
            (!application ||
              application.status !== 'APPROVED' ||
              application.assistantshipId)
          )
            throw new ConflictException({
              code: 'APPLICATION_UNAVAILABLE',
              message: 'La postulación no está disponible para completar',
            });
          if (application) {
            const studentId =
              application.studentId ??
              (
                await transaction.student.findUnique({
                  where: { email: application.studentEmail },
                  select: { id: true },
                })
              )?.id;
            if (studentId && studentId !== input.studentId)
              invalid(
                'APPLICATION_STUDENT',
                'Selecciona el estudiante vinculado a la postulación',
              );
          }
          const existing = id
            ? await transaction.assistantship.findUnique({
                where: { id },
                select: { id: true, tariffId: true, tariffRateClp: true },
              })
            : null;
          if (id && !existing)
            throw new NotFoundException({
              code: 'NOT_FOUND',
              message: 'La ayudantía no existe',
            });
          const { semester, assignment, historical, courseId } =
            await this.resolveAcademicContext(
              transaction,
              input,
              startsOn,
              endsOn,
            );
          if (!input.tariffId)
            invalid('TARIFF_REQUIRED', 'Selecciona una tarifa de ayudantía');
          const tariff = await transaction.assistantshipTariff.findFirst({
            where: { id: input.tariffId, semesterId: semester.id },
          });
          if (!tariff)
            invalid(
              'INVALID_TARIFF',
              'La tarifa no pertenece al semestre seleccionado',
            );
          const tariffRateClp =
            existing?.tariffId === tariff!.id && existing.tariffRateClp
              ? existing.tariffRateClp
              : tariff!.monthlyRateClp;
          const assistant = await this.resolveAssistant(transaction, input);
          const approval = await transaction.assistantCourseApproval.findUnique(
            {
              where: {
                assistantId_courseId: {
                  assistantId: assistant.id,
                  courseId: courseId,
                },
              },
            },
          );
          if (approval && isoDate(approval.approvedOn) !== input.approvedOn)
            throw new ConflictException({
              code: 'APPROVAL_MISMATCH',
              message:
                'La fecha de aprobación no coincide con la ya registrada',
            });
          if (!approval)
            await transaction.assistantCourseApproval.create({
              data: {
                assistantId: assistant.id,
                courseId: courseId,
                approvedOn,
              },
            });
          const conflicts = await transaction.assistantship.findMany({
            where: {
              assistantId: assistant.id,
              ...(id ? { id: { not: id } } : {}),
              startsOn: { lte: endsOn },
              OR: [{ endsOn: null }, { endsOn: { gte: startsOn } }],
            },
            include: { schedules: true },
          });
          if (
            conflicts.some((other) =>
              other.schedules.some((stored) =>
                schedules.some(
                  (candidate) =>
                    candidate.weekday === stored.weekday &&
                    candidate.startsAtMinute < stored.endsAtMinute &&
                    stored.startsAtMinute < candidate.endsAtMinute,
                ),
              ),
            )
          )
            invalid(
              'SCHEDULE_CONFLICT',
              'El ayudante tiene otra ayudantía con horario incompatible',
            );
          const data = {
            nrc: input.assistantshipNrc.trim(),
            teachingAssignmentId: assignment?.id ?? null,
            semesterId: semester.id,
            careerId: historical ? input.careerId : null,
            courseNrc: historical
              ? input.courseNrc?.trim() || null
              : assignment!.nrc,
            courseId: courseId,
            assistantId: assistant.id,
            approvedOn,
            startsOn,
            endsOn,
            weeklyHours: input.weeklyHours ?? null,
            tariffId: tariff!.id,
            tariffRateClp,
            schedules: {
              ...(id ? { deleteMany: {} } : {}),
              create: schedules.map((schedule) => ({
                ...schedule,
                location: schedule.location?.trim() || null,
              })),
            },
          };
          if (id)
            return transaction.assistantship.update({
              where: { id },
              data,
              include,
            });
          const created = await transaction.assistantship.create({
            data,
            include,
          });
          if (application) {
            const linked =
              await transaction.assistantshipApplication.updateMany({
                where: {
                  id: application.id,
                  status: 'APPROVED',
                  assistantshipId: null,
                },
                data: {
                  assistantshipId: created.id,
                  studentId: input.studentId,
                },
              });
            if (!linked.count)
              throw new ConflictException({
                code: 'APPLICATION_UNAVAILABLE',
                message: 'La postulación ya se completó',
              });
          }
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.view(record, this.today());
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002')
          throw new ConflictException({
            code: 'DUPLICATE',
            message:
              'La ayudantía o los datos del estudiante ya están registrados',
          });
        if (error.code === 'P2034')
          throw new ConflictException({
            code: 'RETRY',
            message: 'Otro registro cambió los datos. Intenta nuevamente',
          });
        if (error.code === 'P2003' || error.code === 'P2004')
          invalid(
            'INVALID_INPUT',
            'Los datos no cumplen las restricciones de la ayudantía',
          );
        throw new BadRequestException({
          code: 'INVALID_INPUT',
          message: 'No se pudo registrar la ayudantía',
        });
      }
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException({
        code: 'SERVER_ERROR',
        message: 'No se pudo registrar la ayudantía',
      });
    }
  }
}
