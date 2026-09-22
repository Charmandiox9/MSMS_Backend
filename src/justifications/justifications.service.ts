import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JustificationInboxStatus,
  JustificationStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

export interface FormJustificationInput {
  externalResponseId: string;
  studentEmail: string;
  absenceDate: string;
  subjectName: string;
  subjectCode?: string;
  parallel?: string;
  reason?: string;
  evidenceKey: string;
  evidenceContentType: string;
}

@Injectable()
export class JustificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  async receiveFormSubmission(input: FormJustificationInput) {
    const absenceDate = this.parseDate(input.absenceDate);
    return this.prisma.justificationInbox.upsert({
      where: { externalResponseId: input.externalResponseId },
      update: { ...input, absenceDate },
      create: { ...input, absenceDate },
    });
  }

  listInbox() {
    return this.prisma.justificationInbox.findMany({
      where: { status: JustificationInboxStatus.UNREAD },
      orderBy: { createdAt: 'asc' },
    });
  }

  listJustifications(status?: JustificationStatus) {
    return this.prisma.justification.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async openInboxEntry(inboxId: string, userId: string) {
    return this.prisma.$transaction(async (transaction) => {
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
  }

  async getEvidenceUrl(id: string) {
    const justification = await this.prisma.justification.findUnique({ where: { id } });
    if (!justification) throw new NotFoundException('Justificación no encontrada');
    return this.storage.createPresignedDownload(justification.evidenceKey);
  }

  async decide(id: string, userId: string, status: JustificationStatus, rejectionReason?: string) {
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
      const result = await transaction.justification.update({
        where: { id },
        data: { status, rejectionReason: status === JustificationStatus.REJECTED ? rejectionReason : null, decidedAt: new Date(), decidedById: userId },
      });
      await transaction.justificationStatusHistory.create({
        data: { justificationId: id, fromStatus: justification.status, toStatus: status, note: rejectionReason, changedById: userId },
      });
      return result;
    });

    await this.notifyDecision(updated);
    return updated;
  }

  private async notifyDecision(justification: {
    status: JustificationStatus;
    studentEmail: string;
    subjectName: string;
    subjectCode: string | null;
    parallel: string | null;
    rejectionReason: string | null;
  }): Promise<void> {
    if (justification.status === JustificationStatus.REJECTED) {
      await this.notifications.send({
        to: justification.studentEmail,
        subject: 'Resultado de tu justificación de inasistencia',
        text: `Tu justificación para ${justification.subjectName} fue rechazada.${justification.rejectionReason ? ` Motivo: ${justification.rejectionReason}` : ''}`,
      });
      return;
    }

    const teachers = await this.prisma.teachingAssignment.findMany({
      where: {
        course: justification.subjectCode ? { code: justification.subjectCode } : { name: justification.subjectName },
        parallel: justification.parallel ?? undefined,
        semester: { isActive: true },
      },
      include: { teacher: true },
    });

    await Promise.all(teachers.map(({ teacher }) => this.notifications.send({
      to: teacher.email,
      subject: 'Justificación de inasistencia aprobada',
      text: `Se aprobó una justificación de inasistencia para ${justification.subjectName}${justification.parallel ? `, paralelo ${justification.parallel}` : ''}.`,
    })));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('La fecha de inasistencia no es válida');
    return date;
  }
}
