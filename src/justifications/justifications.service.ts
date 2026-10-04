import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  JustificationInboxStatus,
  JustificationStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationMessage, NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

export interface FormJustificationInput {
  externalResponseId: string;
  studentEmail: string;
  absenceDate: string;
  subjectName?: string;
  subjectCode?: string;
  nrc: string;
  reason?: string;
  evidenceKey: string;
  evidenceContentType: string;
}

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

type TeacherContact = { name: string; email: string };
type ScheduleSource = { nrc: string | null; absenceDate: Date };

@Injectable()
export class JustificationsService {
  private readonly logger = new Logger(JustificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  async receiveFormSubmission(input: FormJustificationInput) {
    const absenceDate = this.parseDate(input.absenceDate);
    const nrc = input.nrc.trim();
    const assignment = await this.prisma.teachingAssignment.findFirst({
      where: { nrc, semester: { isActive: true } },
      include: { course: true },
    });
    const subjectName = assignment?.course.name ?? input.subjectName?.trim();
    if (!subjectName) throw new BadRequestException('El NRC no corresponde a una asignatura activa');

    return this.prisma.justificationInbox.upsert({
      where: { externalResponseId: input.externalResponseId },
      update: { ...input, nrc, subjectName, subjectCode: assignment?.course.code ?? input.subjectCode, absenceDate },
      create: { ...input, nrc, subjectName, subjectCode: assignment?.course.code ?? input.subjectCode, absenceDate },
    });
  }

  async listInbox() {
    const entries = await this.prisma.justificationInbox.findMany({
      where: { status: JustificationInboxStatus.UNREAD },
      orderBy: { createdAt: 'asc' },
    });

    const blocks = await this.findScheduleBlocks(entries);
    return entries.map((entry) => ({ ...entry, blocks: blocks(entry) }));
  }

  async listJustifications(status?: JustificationStatus) {
    const justifications = await this.prisma.justification.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });

    return this.withTeachersAndBlocks(justifications);
  }

  async openInboxEntry(inboxId: string, userId: string) {
    const justification = await this.prisma.$transaction(async (transaction) => {
      const inbox = await transaction.justificationInbox.findUnique({ where: { id: inboxId } });
      if (!inbox) throw new NotFoundException('Entrada de formulario no encontrada');

      if (inbox.justificationId) {
        return transaction.justification.findUniqueOrThrow({ where: { id: inbox.justificationId } });
      }

      const justification = await transaction.justification.create({
        data: {
          id: randomUUID(),
          sourceResponseId: inbox.externalResponseId,
          studentEmail: inbox.studentEmail,
          absenceDate: inbox.absenceDate,
          subjectName: inbox.subjectName,
          subjectCode: inbox.subjectCode,
          nrc: inbox.nrc,
          reasonCategory: inbox.reasonCategory,
          parallel: inbox.parallel,
          reason: inbox.reason,
          evidenceKey: inbox.evidenceKey,
          evidenceContentType: inbox.evidenceContentType,
          createdById: userId,
          history: { create: { toStatus: JustificationStatus.PENDING, changedById: userId } },
        },
      });

      await transaction.justificationInbox.update({
        where: { id: inbox.id },
        data: { status: JustificationInboxStatus.READ, readAt: new Date(), justificationId: justification.id },
      });

      return justification;
    });

    const [withContext] = await this.withTeachersAndBlocks([justification]);
    return withContext;
  }

  async getEvidenceUrl(id: string) {
    const justification = await this.prisma.justification.findUnique({ where: { id } });
    if (!justification) throw new NotFoundException('Justificación no encontrada');
    return this.storage.createPresignedDownload(justification.evidenceKey);
  }

  async decide(id: string, userId: string, status: JustificationStatus, rejectionReason?: string, reasonCategory?: string) {
    if (status !== JustificationStatus.ACCEPTED && status !== JustificationStatus.REJECTED) {
      throw new BadRequestException('La decisión debe ser ACCEPTED o REJECTED');
    }

    const justification = await this.prisma.justification.findUnique({ where: { id } });
    if (!justification) throw new NotFoundException('Justificación no encontrada');
    if (justification.status !== JustificationStatus.PENDING) {
      throw new BadRequestException('La justificación ya fue resuelta');
    }
    if (status === JustificationStatus.REJECTED && !rejectionReason?.trim()) {
      throw new BadRequestException('Indica el motivo del rechazo');
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      // El filtro por estado hace que solo una decisión concurrente se aplique.
      const { count } = await transaction.justification.updateMany({
        where: { id, status: JustificationStatus.PENDING },
        data: { status, rejectionReason: status === JustificationStatus.REJECTED ? rejectionReason : null, reasonCategory, decidedAt: new Date(), decidedById: userId },
      });
      if (count === 0) throw new BadRequestException('La justificación ya fue resuelta');
      await transaction.justificationStatusHistory.create({
        data: { justificationId: id, fromStatus: JustificationStatus.PENDING, toStatus: status, note: rejectionReason, changedById: userId },
      });
      return transaction.justification.findUniqueOrThrow({ where: { id } });
    });

    const [withContext] = await this.withTeachersAndBlocks([updated]);
    await this.notifyDecision(updated, withContext.teachers);
    return withContext;
  }

  private async notifyDecision(
    justification: {
      status: JustificationStatus;
      studentEmail: string;
      subjectName: string;
      subjectCode: string | null;
      nrc: string | null;
      parallel: string | null;
      rejectionReason: string | null;
    },
    teachers: TeacherContact[],
  ): Promise<void> {
    if (justification.status === JustificationStatus.REJECTED) {
      await this.sendAll([{
        to: justification.studentEmail,
        subject: 'Resultado de tu justificación de inasistencia',
        text: `Tu justificación para ${justification.subjectName} fue rechazada.${justification.rejectionReason ? ` Motivo: ${justification.rejectionReason}` : ''}`,
      }]);
      return;
    }

    if (teachers.length === 0) {
      this.logger.warn(`Aprobación sin profesores destinatarios nrc=${justification.nrc ?? '<none>'}`);
    } else {
      this.logger.log(
        `Destinatarios de aprobación nrc=${justification.nrc ?? '<none>'} teacherCount=${teachers.length} teacherEmails=${teachers.map((teacher) => teacher.email).join(',')}`,
      );
    }

    await this.sendAll([
      {
        to: justification.studentEmail,
        subject: 'Tu justificación de inasistencia fue aprobada',
        text: `Tu justificación para ${justification.subjectName}${justification.nrc ? ` (NRC ${justification.nrc})` : ''} fue aprobada.`,
      },
      ...teachers.map((teacher) => ({
        to: teacher.email,
        subject: 'Justificación de inasistencia aprobada',
        text: `Se aprobó una justificación de inasistencia para ${justification.subjectName}${justification.nrc ? ` (NRC ${justification.nrc})` : ''}.`,
      })),
    ]);
  }

  // La decisión ya está guardada: un correo fallido se registra, pero no
  // convierte la respuesta en error ni impide los demás envíos.
  private async sendAll(messages: NotificationMessage[]): Promise<void> {
    const results = await Promise.allSettled(messages.map((message) => this.notifications.send(message)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.logger.error(`No se pudo notificar la decisión a ${messages[index].to}: ${reason}`);
      }
    });
  }

  private async withTeachersAndBlocks<T extends ScheduleSource>(rows: T[]) {
    const [teachers, blocks] = await Promise.all([
      this.findTeachers(rows.map(({ nrc }) => nrc)),
      this.findScheduleBlocks(rows),
    ]);
    return rows.map((row) => ({ ...row, teachers: teachers(row.nrc), blocks: blocks(row) }));
  }

  /** Profesores por NRC en una sola consulta, sin importar cuántas filas haya. */
  private async findTeachers(nrcs: (string | null)[]): Promise<(nrc: string | null) => TeacherContact[]> {
    const normalized = [...new Set(nrcs.map((nrc) => nrc?.trim()).filter((nrc): nrc is string => !!nrc))];
    if (normalized.length === 0) return () => [];

    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { nrc: { in: normalized } },
      select: {
        nrc: true,
        teacherId: true,
        teacher: { select: { name: true, email: true } },
        semester: { select: { isActive: true } },
      },
    });

    const byNrc = new Map<string, TeacherContact[]>();
    for (const nrc of normalized) {
      const forNrc = assignments.filter((assignment) => assignment.nrc === nrc);
      // Keep historical justifications routable if the active semester changes
      // between intake and the decision.
      const active = forNrc.filter(({ semester }) => semester.isActive);
      const teachers = new Map<string, TeacherContact>();
      for (const { teacherId, teacher } of active.length > 0 ? active : forNrc) teachers.set(teacherId, teacher);
      byNrc.set(nrc, [...teachers.values()]);
    }
    return (nrc) => byNrc.get(nrc?.trim() ?? '') ?? [];
  }

  /** Bloques del día de la inasistencia por NRC en una sola consulta; usa el histórico si el semestre activo no tiene. */
  private async findScheduleBlocks(rows: ScheduleSource[]): Promise<(row: ScheduleSource) => string[]> {
    const keyOf = ({ nrc, absenceDate }: ScheduleSource) => {
      const normalizedNrc = nrc?.trim();
      const day = this.weekdayOf(absenceDate);
      return normalizedNrc && day ? `${normalizedNrc}|${day}` : undefined;
    };
    const byKey = new Map<string, string[]>();
    const lookup = (row: ScheduleSource) => byKey.get(keyOf(row) ?? '') ?? [];

    const keys = [...new Set(rows.map(keyOf).filter((key): key is string => !!key))];
    if (keys.length === 0) return lookup;

    try {
      const schedules = await this.prisma.courseSchedule.findMany({
        where: {
          nrc: { in: [...new Set(keys.map((key) => key.split('|')[0]))] },
          day: { in: [...new Set(keys.map((key) => key.split('|')[1]))] },
        },
        orderBy: { block: 'asc' },
        select: { nrc: true, day: true, block: true, semester: { select: { isActive: true } } },
      });
      for (const key of keys) {
        const forKey = schedules.filter(({ nrc, day }) => `${nrc}|${day}` === key);
        const active = forKey.filter(({ semester }) => semester.isActive);
        byKey.set(key, (active.length > 0 ? active : forKey).map(({ block }) => block));
      }
    } catch (error) {
      this.logger.warn(`No se pudieron cargar los bloques de horario: ${error instanceof Error ? error.message : String(error)}`);
      byKey.clear();
    }
    return lookup;
  }

  /** Día de la semana de la fecha (UTC); `undefined` para domingo o fechas inválidas. */
  private weekdayOf(absenceDate: Date | string | null | undefined): string | undefined {
    if (!absenceDate) return undefined;
    const dateObj = absenceDate instanceof Date ? absenceDate : new Date(absenceDate);
    if (Number.isNaN(dateObj.getTime())) return undefined;

    const [y, m, d] = dateObj.toISOString().slice(0, 10).split('-').map(Number);
    const dayName = WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()];
    return dayName === 'Domingo' ? undefined : dayName;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('La fecha de inasistencia no es válida');
    return date;
  }
}
