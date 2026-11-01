import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DataRightsRequestStatus,
  DataRightsRequestType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const OPEN_STATUSES = [
  DataRightsRequestStatus.RECEIVED,
  DataRightsRequestStatus.VERIFYING,
  DataRightsRequestStatus.IN_PROGRESS,
] as const;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

const TRANSITIONS: Readonly<
  Record<DataRightsRequestStatus, readonly DataRightsRequestStatus[]>
> = {
  RECEIVED: [DataRightsRequestStatus.VERIFYING, DataRightsRequestStatus.DENIED],
  VERIFYING: [
    DataRightsRequestStatus.IN_PROGRESS,
    DataRightsRequestStatus.DENIED,
  ],
  IN_PROGRESS: [
    DataRightsRequestStatus.COMPLETED,
    DataRightsRequestStatus.DENIED,
  ],
  COMPLETED: [DataRightsRequestStatus.CLOSED],
  DENIED: [DataRightsRequestStatus.CLOSED],
  CLOSED: [],
};

@Injectable()
export class DataRightsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    subjectUserId: string,
    rightType: DataRightsRequestType,
    details?: string,
  ) {
    if (rightType !== DataRightsRequestType.ACCESS && !details?.trim()) {
      throw new BadRequestException(
        'Se requiere identificar los datos o el tratamiento y explicar la solicitud',
      );
    }
    const submittedAt = new Date();
    const dueAt = new Date(
      submittedAt.getTime() +
        (rightType === DataRightsRequestType.BLOCKING
          ? FORTY_EIGHT_HOURS_MS
          : THIRTY_DAYS_MS),
    );
    const activeRequest = await this.prisma.dataRightsRequest.findFirst({
      where: {
        subjectUserId,
        rightType,
        status: { in: [...OPEN_STATUSES] },
      },
      select: { id: true },
    });

    if (activeRequest) {
      throw new ConflictException(
        'Ya existe una solicitud de este tipo en curso',
      );
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const request = await transaction.dataRightsRequest.create({
          data: {
            subjectUserId,
            rightType,
            ...(details ? { details } : {}),
            createdAt: submittedAt,
            dueAt,
          },
          select: {
            id: true,
            rightType: true,
            details: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            dueAt: true,
          },
        });
        await transaction.dataRightsRequestEvent.create({
          data: {
            requestId: request.id,
            actorId: subjectUserId,
            eventType: 'SUBMITTED',
            toStatus: DataRightsRequestStatus.RECEIVED,
          },
        });
        return request;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe una solicitud de este tipo en curso',
        );
      }
      throw error;
    }
  }

  listMine(subjectUserId: string) {
    return this.prisma.dataRightsRequest.findMany({
      where: { subjectUserId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 50,
      select: {
        id: true,
        rightType: true,
        status: true,
        details: true,
        responseNote: true,
        createdAt: true,
        updatedAt: true,
        closedAt: true,
        dueAt: true,
        extendedAt: true,
        extensionNote: true,
        respondedAt: true,
      },
    });
  }

  async listQueue(page: number, pageSize: number) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(50, Math.max(1, pageSize));
    const where = { status: { not: DataRightsRequestStatus.CLOSED } };
    const [items, total] = await Promise.all([
      this.prisma.dataRightsRequest.findMany({
        where,
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        select: {
          id: true,
          rightType: true,
          status: true,
          details: true,
          responseNote: true,
          dueAt: true,
          extendedAt: true,
          extensionNote: true,
          respondedAt: true,
          createdAt: true,
          updatedAt: true,
          subject: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.dataRightsRequest.count({ where }),
    ]);
    return {
      items,
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    };
  }

  async updateStatus(
    id: string,
    status: DataRightsRequestStatus,
    actorId: string,
    responseNote?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.dataRightsRequest.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!current) throw new NotFoundException('Solicitud no encontrada');
      if (!TRANSITIONS[current.status].includes(status)) {
        throw new BadRequestException('Transición de estado no permitida');
      }
      if (
        (status === DataRightsRequestStatus.COMPLETED ||
          status === DataRightsRequestStatus.DENIED) &&
        !responseNote?.trim()
      ) {
        throw new BadRequestException(
          'Se requiere una respuesta para completar o rechazar la solicitud',
        );
      }

      const update = await transaction.dataRightsRequest.updateMany({
        where: { id, status: current.status },
        data: {
          status,
          ...(responseNote !== undefined ? { responseNote } : {}),
          ...(status === DataRightsRequestStatus.COMPLETED ||
          status === DataRightsRequestStatus.DENIED
            ? { respondedAt: new Date() }
            : {}),
          ...(status === DataRightsRequestStatus.CLOSED
            ? { closedAt: new Date() }
            : {}),
        },
      });
      if (update.count !== 1) {
        throw new ConflictException(
          'La solicitud fue actualizada por otra persona',
        );
      }
      await transaction.dataRightsRequestEvent.create({
        data: {
          requestId: id,
          actorId,
          eventType: 'STATUS_CHANGED',
          fromStatus: current.status,
          toStatus: status,
        },
      });
      return transaction.dataRightsRequest.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          rightType: true,
          status: true,
          responseNote: true,
          updatedAt: true,
          closedAt: true,
          dueAt: true,
          extendedAt: true,
          extensionNote: true,
          respondedAt: true,
        },
      });
    });
  }

  async extendDeadline(id: string, actorId: string, note: string) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.dataRightsRequest.findUnique({
        where: { id },
        select: {
          id: true,
          rightType: true,
          status: true,
          dueAt: true,
          extendedAt: true,
        },
      });
      if (!current) throw new NotFoundException('Solicitud no encontrada');
      if (current.rightType === DataRightsRequestType.BLOCKING) {
        throw new BadRequestException(
          'Los requerimientos de bloqueo deben mantenerse en el flujo prioritario',
        );
      }
      if (
        !OPEN_STATUSES.includes(
          current.status as (typeof OPEN_STATUSES)[number],
        )
      ) {
        throw new BadRequestException('La solicitud ya recibió una respuesta');
      }
      if (current.extendedAt) {
        throw new ConflictException('El plazo ya fue prorrogado');
      }

      const extendedAt = new Date();
      const update = await transaction.dataRightsRequest.updateMany({
        where: { id, status: current.status, extendedAt: null },
        data: {
          dueAt: new Date(current.dueAt.getTime() + THIRTY_DAYS_MS),
          extendedAt,
          extensionNote: note,
        },
      });
      if (update.count !== 1) {
        throw new ConflictException(
          'La solicitud fue actualizada por otra persona',
        );
      }

      await transaction.dataRightsRequestEvent.create({
        data: {
          requestId: id,
          actorId,
          eventType: 'DEADLINE_EXTENDED',
          fromStatus: current.status,
          toStatus: current.status,
        },
      });
      return transaction.dataRightsRequest.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          status: true,
          dueAt: true,
          extendedAt: true,
          extensionNote: true,
          updatedAt: true,
        },
      });
    });
  }
}
