import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AssistantshipApplicationStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AssistantshipApplicationDecisionDto,
  AssistantshipApplicationSubmissionDto,
} from './assistantship-applications.dto';

const PAGE_SIZE = 20;
const studentSelect = {
  id: true,
  name: true,
  email: true,
  career: { select: { id: true, name: true } },
} satisfies Prisma.StudentSelect;

const listSelect = {
  id: true,
  name: true,
  subject: true,
  submittedAt: true,
  status: true,
  studentId: true,
  assistantshipId: true,
} satisfies Prisma.AssistantshipApplicationSelect;

const detailSelect = {
  ...listSelect,
  studentEmail: true,
  rut: true,
  phone: true,
  submittedCareer: true,
  address: true,
  motivation: true,
  ppa: true,
  reviewedAt: true,
  reviewNote: true,
  notification: true,
  student: { select: studentSelect },
} satisfies Prisma.AssistantshipApplicationSelect;

@Injectable()
export class AssistantshipApplicationsService {
  private readonly logger = new Logger(AssistantshipApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async receive(input: AssistantshipApplicationSubmissionDto) {
    const studentEmail = input.studentEmail.trim().toLowerCase();
    const student = await this.prisma.student.findUnique({
      where: { email: studentEmail },
      select: { id: true },
    });
    try {
      await this.prisma.assistantshipApplication.create({
        data: {
          ...input,
          studentEmail,
          submittedAt: new Date(input.submittedAt),
          studentId: student?.id,
        },
        select: { id: true },
      });
      return { received: true, duplicate: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return { received: true, duplicate: true };
      throw error;
    }
  }

  async list(status: AssistantshipApplicationStatus, page: number) {
    const records = await this.prisma.assistantshipApplication.findMany({
      where: { status },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: listSelect,
    });
    return {
      items: records.slice(0, PAGE_SIZE),
      hasMore: records.length > PAGE_SIZE,
    };
  }

  async detail(id: string) {
    const application = await this.prisma.assistantshipApplication.findUnique({
      where: { id },
      select: detailSelect,
    });
    if (!application) throw new NotFoundException('La postulación no existe');
    const student =
      application.student ??
      (await this.prisma.student.findUnique({
        where: { email: application.studentEmail },
        select: studentSelect,
      }));
    return { ...application, student };
  }

  async decide(
    id: string,
    reviewerId: string,
    input: AssistantshipApplicationDecisionDto,
  ) {
    const application = await this.detail(id);
    const result = await this.prisma.assistantshipApplication.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: input.status,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote?.trim() || null,
        studentId: application.student?.id,
        notification: input.notify ? 'PENDING' : 'NOT_REQUESTED',
      },
    });
    if (!result.count)
      throw new ConflictException('La postulación ya fue revisada');

    if (input.notify) {
      let notification: 'SENT' | 'FAILED' = 'FAILED';
      if (
        this.config.get<string>('RESEND_API_KEY') &&
        this.config.get<string>('NOTIFICATIONS_FROM')
      ) {
        const accepted = input.status === 'APPROVED';
        try {
          await this.notifications.send({
            to: application.studentEmail,
            subject: accepted
              ? 'Postulación de ayudantía aprobada'
              : 'Resultado de tu postulación de ayudantía',
            text: accepted
              ? 'Tu postulación de ayudantía fue aprobada. El equipo de Apoyo Docente coordinará contigo el horario.'
              : 'Tu postulación de ayudantía no fue seleccionada. Gracias por participar.',
          });
          notification = 'SENT';
        } catch {
          this.logger.warn('No se pudo enviar la notificación de postulación');
        }
      }
      await this.prisma.assistantshipApplication.update({
        where: { id },
        data: { notification },
        select: { id: true },
      });
    }
    return this.detail(id);
  }
}
