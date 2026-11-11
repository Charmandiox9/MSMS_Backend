import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  DataRightsRequestStatus as Status,
  DataRightsRequestType as Right,
} from '@prisma/client';
import { DataRightsService } from './data-rights.service';

describe('DataRightsService', () => {
  const request = {
    id: 'request-1',
    subjectUserId: 'subject-1',
    rightType: Right.ACCESS,
    status: Status.RECEIVED,
    responseNote: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    dueAt: new Date('2026-12-01T00:00:00.000Z'),
    extendedAt: null,
    closedAt: null,
  };
  const prisma = {
    dataRightsRequest: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    dataRightsRequestEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: DataRightsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (transaction: typeof prisma) => unknown) => callback(prisma),
    );
    service = new DataRightsService(prisma as never);
  });

  it('creates a minimal, user-bound request and its initial event atomically', async () => {
    prisma.dataRightsRequest.findFirst.mockResolvedValue(null);
    prisma.dataRightsRequest.create.mockResolvedValue(request);

    await expect(service.create('subject-1', Right.ACCESS)).resolves.toBe(
      request,
    );

    expect(prisma.dataRightsRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subjectUserId: 'subject-1',
          rightType: Right.ACCESS,
          dueAt: expect.any(Date),
        }),
        select: expect.objectContaining({
          id: true,
          status: true,
          dueAt: true,
        }),
      }),
    );
    expect(prisma.dataRightsRequestEvent.create).toHaveBeenCalledWith({
      data: {
        requestId: 'request-1',
        actorId: 'subject-1',
        eventType: 'SUBMITTED',
        toStatus: Status.RECEIVED,
      },
    });
  });

  it('prevents duplicate open requests for the same right', async () => {
    prisma.dataRightsRequest.findFirst.mockResolvedValue({
      id: 'request-existing',
    });

    await expect(service.create('subject-1', Right.ACCESS)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.dataRightsRequest.create).not.toHaveBeenCalled();
  });

  it('requires request details for rights other than access', async () => {
    await expect(
      service.create('subject-1', Right.RECTIFICATION),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.dataRightsRequest.findFirst).not.toHaveBeenCalled();
  });

  it('stores the scoped details supplied for a non-access request', async () => {
    prisma.dataRightsRequest.findFirst.mockResolvedValue(null);
    prisma.dataRightsRequest.create.mockResolvedValue({
      ...request,
      rightType: Right.RECTIFICATION,
      details: 'Corregir mi correo de contacto',
    });

    await service.create(
      'subject-1',
      Right.RECTIFICATION,
      'Corregir mi correo de contacto',
    );

    expect(prisma.dataRightsRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          details: 'Corregir mi correo de contacto',
        }),
      }),
    );
  });

  it('sets a conservative 48-hour operational target for blocking requests', async () => {
    prisma.dataRightsRequest.findFirst.mockResolvedValue(null);
    prisma.dataRightsRequest.create.mockImplementation(
      ({ data }: { data: typeof request }) => Promise.resolve(data),
    );

    await service.create(
      'subject-1',
      Right.BLOCKING,
      'Bloqueo de este tratamiento',
    );

    const createData = prisma.dataRightsRequest.create.mock.calls[0][0].data;
    expect(createData.dueAt.getTime() - createData.createdAt.getTime()).toBe(
      48 * 60 * 60 * 1000,
    );
  });

  it('returns only requests owned by the authenticated subject', async () => {
    prisma.dataRightsRequest.findMany.mockResolvedValue([request]);

    await service.listMine('subject-1');

    expect(prisma.dataRightsRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subjectUserId: 'subject-1' },
        take: 50,
      }),
    );
  });

  it('requires a response note before a request is completed or denied', async () => {
    prisma.dataRightsRequest.findUnique.mockResolvedValue(request);

    await expect(
      service.updateStatus('request-1', Status.DENIED, 'officer-1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.dataRightsRequest.updateMany).not.toHaveBeenCalled();
  });

  it('rejects invalid status transitions', async () => {
    prisma.dataRightsRequest.findUnique.mockResolvedValue(request);

    await expect(
      service.updateStatus('request-1', Status.CLOSED, 'officer-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('records each authorized status change in the same transaction', async () => {
    prisma.dataRightsRequest.findUnique.mockResolvedValue(request);
    prisma.dataRightsRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.dataRightsRequest.findUniqueOrThrow.mockResolvedValue({
      ...request,
      status: Status.VERIFYING,
    });

    await service.updateStatus('request-1', Status.VERIFYING, 'officer-1');

    expect(prisma.dataRightsRequestEvent.create).toHaveBeenCalledWith({
      data: {
        requestId: 'request-1',
        actorId: 'officer-1',
        eventType: 'STATUS_CHANGED',
        fromStatus: Status.RECEIVED,
        toStatus: Status.VERIFYING,
      },
    });
  });

  it('does not overwrite a status changed by another reviewer', async () => {
    prisma.dataRightsRequest.findUnique.mockResolvedValue(request);
    prisma.dataRightsRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateStatus('request-1', Status.VERIFYING, 'officer-1'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.dataRightsRequestEvent.create).not.toHaveBeenCalled();
  });

  it('returns not found when a reviewer updates a missing request', async () => {
    prisma.dataRightsRequest.findUnique.mockResolvedValue(null);

    await expect(
      service.updateStatus('missing', Status.VERIFYING, 'officer-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('extends the deadline once and records the encrypted reason and audit event', async () => {
    prisma.dataRightsRequest.findUnique.mockResolvedValue(request);
    prisma.dataRightsRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.dataRightsRequest.findUniqueOrThrow.mockResolvedValue({
      ...request,
      dueAt: new Date('2026-12-31T00:00:00.000Z'),
      extendedAt: new Date('2026-11-15T00:00:00.000Z'),
    });

    await service.extendDeadline(
      'request-1',
      'officer-1',
      'Complejidad del caso',
    );

    expect(prisma.dataRightsRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'request-1', status: Status.RECEIVED, extendedAt: null },
      data: expect.objectContaining({
        dueAt: new Date('2026-12-31T00:00:00.000Z'),
        extensionNote: 'Complejidad del caso',
      }),
    });
    expect(prisma.dataRightsRequestEvent.create).toHaveBeenCalledWith({
      data: {
        requestId: 'request-1',
        actorId: 'officer-1',
        eventType: 'DEADLINE_EXTENDED',
        fromStatus: Status.RECEIVED,
        toStatus: Status.RECEIVED,
      },
    });
  });

  it('does not extend a deadline twice', async () => {
    prisma.dataRightsRequest.findUnique.mockResolvedValue({
      ...request,
      extendedAt: new Date('2026-11-15T00:00:00.000Z'),
    });

    await expect(
      service.extendDeadline('request-1', 'officer-1', 'Motivo'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.dataRightsRequest.updateMany).not.toHaveBeenCalled();
  });

  it('does not offer the general extension on blocking requests', async () => {
    prisma.dataRightsRequest.findUnique.mockResolvedValue({
      ...request,
      rightType: Right.BLOCKING,
    });

    await expect(
      service.extendDeadline('request-1', 'officer-1', 'Motivo'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.dataRightsRequest.updateMany).not.toHaveBeenCalled();
  });
});
