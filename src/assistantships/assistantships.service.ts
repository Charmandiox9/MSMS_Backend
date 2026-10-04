import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssistantshipFilters,
  AssistantshipState,
  AssistantshipView,
  RegisterAssistantshipInput,
} from './assistantships.dto';

const include = {
  approval: { include: { assistant: true } },
  teachingAssignment: {
    include: { teacher: true, course: true, semester: true },
  },
  schedules: { orderBy: [{ weekday: 'asc' }, { startsAtMinute: 'asc' }] },
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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
      assistantName: assistant.name,
      assistantEmail: assistant.email,
      studentCode: assistant.studentCode,
      courseName: assignment.course.name,
      courseCode: assignment.course.code,
      nrc: assignment.nrc,
      teacherName: assignment.teacher.name,
      semesterId: assignment.semesterId,
      semesterName: assignment.semester.name,
      approvedOn: isoDate(record.approvedOn),
      startsOn: isoDate(record.startsOn),
      endsOn: record.endsOn ? isoDate(record.endsOn) : null,
      weeklyHours: record.weeklyHours?.toNumber() ?? null,
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
    const where: Prisma.AssistantshipWhereInput = {
      teachingAssignment: {
        ...(filters.semesterId ? { semesterId: filters.semesterId } : {}),
        ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
      },
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
                      { name: text },
                      { email: text },
                      { studentCode: text },
                    ],
                  },
                },
              },
              {
                teachingAssignment: {
                  OR: [
                    { nrc: text },
                    { course: { OR: [{ name: text }, { code: text }] } },
                    { teacher: { name: text } },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    const [total, assistants, semesters] = await Promise.all([
      this.prisma.assistantship.count({ where }),
      this.prisma.assistantship.groupBy({ by: ['assistantId'], where }),
      this.prisma.teachingAssignment.findMany({
        where: { assistantships: { some: where } },
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
        { teachingAssignment: { semester: { startsOn: 'desc' } } },
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

  async options() {
    const [semesters, teachers] = await Promise.all([
      this.prisma.academicSemester.findMany({
        orderBy: [{ startsOn: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.teacher.findMany({
        where: { assignments: { some: {} } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    return {
      semesters: semesters.map((semester) => ({
        ...semester,
        startsOn: isoDate(semester.startsOn),
        endsOn: isoDate(semester.endsOn),
      })),
      teachers,
    };
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

  async register(
    input: RegisterAssistantshipInput,
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
          const assignment = await transaction.teachingAssignment.findUnique({
            where: { id: input.teachingAssignmentId },
            include: { teacher: true, semester: true },
          });
          if (!assignment)
            throw new NotFoundException({
              code: 'ASSIGNMENT_NOT_FOUND',
              message: 'La asignación docente no existe',
            });
          if (!assignment.teacher.isActive || !assignment.nrc)
            invalid(
              'INACTIVE_PROFILE',
              'El profesor debe estar activo y tener un NRC',
            );
          if (
            startsOn < new Date(isoDate(assignment.semester.startsOn)) ||
            endsOn > new Date(isoDate(assignment.semester.endsOn))
          )
            invalid(
              'SEMESTER_PERIOD',
              'La ayudantía debe estar dentro del semestre',
            );
          const email = input.assistantEmail.trim().toLowerCase();
          const studentCode = input.studentCode?.trim() || null;
          const existing = await transaction.teachingAssistant.findUnique({
            where: { email },
          });
          if (existing && !existing.isActive)
            invalid('INACTIVE_PROFILE', 'El estudiante ayudante está inactivo');
          if (
            existing &&
            (existing.name !== input.assistantName.trim() ||
              (studentCode && existing.studentCode !== studentCode))
          )
            throw new ConflictException({
              code: 'ASSISTANT_IDENTITY',
              message: 'El correo ya pertenece a un estudiante con otros datos',
            });
          const assistant =
            existing ??
            (await transaction.teachingAssistant.create({
              data: { name: input.assistantName.trim(), email, studentCode },
            }));
          const approval = await transaction.assistantCourseApproval.findUnique(
            {
              where: {
                assistantId_courseId: {
                  assistantId: assistant.id,
                  courseId: assignment.courseId,
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
                courseId: assignment.courseId,
                approvedOn,
              },
            });
          const conflicts = await transaction.assistantship.findMany({
            where: {
              assistantId: assistant.id,
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
          return transaction.assistantship.create({
            data: {
              teachingAssignmentId: assignment.id,
              courseId: assignment.courseId,
              assistantId: assistant.id,
              approvedOn,
              startsOn,
              endsOn,
              weeklyHours: input.weeklyHours,
              schedules: {
                create: schedules.map((schedule) => ({
                  ...schedule,
                  location: schedule.location?.trim() || null,
                })),
              },
            },
            include,
          });
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
