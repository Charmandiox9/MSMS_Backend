import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JustificationInboxStatus, JustificationStatus } from '@prisma/client';
import { JustificationsService } from './justifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

describe('JustificationsService', () => {
  let service: JustificationsService;

  const mockPrisma = {
    teachingAssignment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    courseSchedule: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    justificationInbox: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    justification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    justificationStatusHistory: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrisma)),
  };

  const mockNotifications = {
    send: jest.fn().mockResolvedValue(undefined),
  };

  const mockStorage = {
    createPresignedDownload: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JustificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get<JustificationsService>(JustificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listInbox', () => {
    it('returns unread inbox entries ordered by creation date with schedule blocks', async () => {
      const mockEntries = [{ id: 'inbox-1', status: JustificationInboxStatus.UNREAD, nrc: '10002', absenceDate: new Date('2026-09-22T00:00:00Z') }];
      mockPrisma.justificationInbox.findMany.mockResolvedValue(mockEntries);
      mockPrisma.courseSchedule.findMany.mockResolvedValue([{ block: 'C' }]);

      const result = await service.listInbox();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('inbox-1');
      expect(result[0].blocks).toEqual(['C']);
      expect(mockPrisma.justificationInbox.findMany).toHaveBeenCalledWith({
        where: { status: JustificationInboxStatus.UNREAD },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('listJustifications', () => {
    it('returns justifications with associated teachers and schedule blocks', async () => {
      const mockJustifications = [
        {
          id: 'just-1',
          nrc: '10002',
          absenceDate: new Date('2026-09-22T00:00:00Z'),
          status: JustificationStatus.PENDING,
          studentEmail: 'student@example.com',
        },
      ];
      mockPrisma.justification.findMany.mockResolvedValue(mockJustifications);
      mockPrisma.teachingAssignment.findMany.mockResolvedValue([
        { teacher: { name: 'Prof. Gomez', email: 'gomez@ucn.cl' } },
      ]);
      mockPrisma.courseSchedule.findMany.mockResolvedValue([{ block: 'C' }]);

      const result = await service.listJustifications();

      expect(result).toHaveLength(1);
      expect(result[0].teachers).toEqual([{ name: 'Prof. Gomez', email: 'gomez@ucn.cl' }]);
      expect(result[0].blocks).toEqual(['C']);
      expect(mockPrisma.justification.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getEvidenceUrl', () => {
    it('throws NotFoundException when justification does not exist', async () => {
      mockPrisma.justification.findUnique.mockResolvedValue(null);

      await expect(service.getEvidenceUrl('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('generates presigned download url for existing evidence', async () => {
      mockPrisma.justification.findUnique.mockResolvedValue({
        id: 'just-1',
        evidenceKey: 'uploads/evidence.pdf',
      });
      mockStorage.createPresignedDownload.mockResolvedValue({
        downloadUrl: 'https://minio.example.com/uploads/evidence.pdf?token=abc',
      });

      const result = await service.getEvidenceUrl('just-1');

      expect(result).toEqual({
        downloadUrl: 'https://minio.example.com/uploads/evidence.pdf?token=abc',
      });
      expect(mockStorage.createPresignedDownload).toHaveBeenCalledWith('uploads/evidence.pdf');
    });
  });

  describe('decide', () => {
    it('throws BadRequestException if decision status is invalid', async () => {
      await expect(
        service.decide('just-1', 'user-1', JustificationStatus.PENDING),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if rejection is missing reason', async () => {
      mockPrisma.justification.findUnique.mockResolvedValue({
        id: 'just-1',
        status: JustificationStatus.PENDING,
      });

      await expect(
        service.decide('just-1', 'user-1', JustificationStatus.REJECTED, ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('approves justification, updates status and sends notifications', async () => {
      const existing = {
        id: 'just-1',
        status: JustificationStatus.PENDING,
        studentEmail: 'student@example.com',
        subjectName: 'Biologia Marina',
        subjectCode: 'BIO101',
        nrc: '12345',
        parallel: '1',
        rejectionReason: null,
      };
      mockPrisma.justification.findUnique.mockResolvedValue(existing);
      mockPrisma.justification.update.mockResolvedValue({
        ...existing,
        status: JustificationStatus.ACCEPTED,
        reasonCategory: 'MEDICAL',
      });
      mockPrisma.teachingAssignment.findMany.mockResolvedValue([
        { teacher: { name: 'Prof. Gomez', email: 'gomez@ucn.cl' } },
      ]);

      const result = await service.decide(
        'just-1',
        'admin-user',
        JustificationStatus.ACCEPTED,
        undefined,
        'MEDICAL',
      );

      expect(result.status).toBe(JustificationStatus.ACCEPTED);
      expect(mockNotifications.send).toHaveBeenCalledTimes(2);
      expect(mockNotifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'student@example.com' }),
      );
      expect(mockNotifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'gomez@ucn.cl' }),
      );
    });
  });
});

describe('JustificationsService flujo completo', () => {
  let service: JustificationsService;
  const prisma = {
    teachingAssignment: { findFirst: jest.fn(), findMany: jest.fn() },
    courseSchedule: { findMany: jest.fn() },
    justificationInbox: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    justification: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn() },
    justificationStatusHistory: { create: jest.fn() },
    $transaction: jest.fn((operation: (client: unknown) => Promise<unknown>) => operation(prisma)),
  };
  const notifications = { send: jest.fn() };

  const submission = {
    externalResponseId: 'resp-1',
    studentEmail: 'student@alumnos.ucn.cl',
    absenceDate: '2026-09-23T00:00:00.000Z',
    subjectName: 'Nombre del formulario',
    nrc: ' 10001 ',
    evidenceKey: 'uploads/evidence.pdf',
    evidenceContentType: 'application/pdf',
  };

  const pending = {
    id: 'just-1',
    status: JustificationStatus.PENDING,
    studentEmail: 'student@alumnos.ucn.cl',
    subjectName: 'Biología',
    subjectCode: 'BIO101',
    nrc: '10001',
    parallel: null,
    rejectionReason: null,
    absenceDate: new Date('2026-09-23T00:00:00Z'),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((operation: (client: unknown) => Promise<unknown>) => operation(prisma));
    prisma.teachingAssignment.findMany.mockResolvedValue([]);
    prisma.courseSchedule.findMany.mockResolvedValue([]);
    notifications.send.mockResolvedValue(undefined);
    service = new JustificationsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      {} as StorageService,
    );
  });

  describe('receiveFormSubmission', () => {
    it('usa la asignatura del semestre activo según el NRC y es idempotente por respuesta', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue({ course: { name: 'Biología', code: 'BIO101' } });
      prisma.justificationInbox.upsert.mockResolvedValue({ id: 'inbox-1' });

      await service.receiveFormSubmission(submission);

      expect(prisma.teachingAssignment.findFirst).toHaveBeenCalledWith({
        where: { nrc: '10001', semester: { isActive: true } },
        include: { course: true },
      });
      const call = prisma.justificationInbox.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ externalResponseId: 'resp-1' });
      expect(call.create).toEqual(
        expect.objectContaining({
          nrc: '10001',
          subjectName: 'Biología',
          subjectCode: 'BIO101',
          absenceDate: new Date('2026-09-23T00:00:00.000Z'),
          evidenceKey: 'uploads/evidence.pdf',
        }),
      );
      expect(call.update).toEqual(call.create);
    });

    it('usa el nombre enviado por el formulario si el NRC no está en el semestre activo', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue(null);

      await service.receiveFormSubmission({ ...submission, subjectName: '  Química  ', subjectCode: 'QUI' });

      expect(prisma.justificationInbox.upsert.mock.calls[0][0].create).toEqual(
        expect.objectContaining({ subjectName: 'Química', subjectCode: 'QUI' }),
      );
    });

    it('rechaza un NRC desconocido sin nombre de asignatura', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue(null);

      await expect(service.receiveFormSubmission({ ...submission, subjectName: '   ' })).rejects.toThrow(
        'El NRC no corresponde a una asignatura activa',
      );
      expect(prisma.justificationInbox.upsert).not.toHaveBeenCalled();
    });

    it('rechaza una fecha de inasistencia inválida', async () => {
      await expect(service.receiveFormSubmission({ ...submission, absenceDate: '31/02/2026' })).rejects.toThrow(
        'La fecha de inasistencia no es válida',
      );
    });
  });

  describe('openInboxEntry', () => {
    const inbox = {
      id: 'inbox-1',
      externalResponseId: 'resp-1',
      justificationId: null,
      studentEmail: 'student@alumnos.ucn.cl',
      absenceDate: new Date('2026-09-23T00:00:00Z'),
      subjectName: 'Biología',
      subjectCode: 'BIO101',
      nrc: '10001',
      reasonCategory: null,
      parallel: null,
      reason: 'Enfermedad',
      evidenceKey: 'uploads/evidence.pdf',
      evidenceContentType: 'application/pdf',
    };

    it('crea la justificación pendiente, registra el historial y marca la entrada como leída', async () => {
      prisma.justificationInbox.findUnique.mockResolvedValue(inbox);
      prisma.justification.create.mockImplementation(({ data }: { data: object }) => Promise.resolve(data));
      prisma.courseSchedule.findMany.mockResolvedValue([{ block: 'C' }, { block: 'D' }]);

      const result = await service.openInboxEntry('inbox-1', 'coordinator-1');

      const data = prisma.justification.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          sourceResponseId: 'resp-1',
          createdById: 'coordinator-1',
          evidenceKey: 'uploads/evidence.pdf',
          history: { create: { toStatus: JustificationStatus.PENDING, changedById: 'coordinator-1' } },
        }),
      );
      expect(prisma.justificationInbox.update).toHaveBeenCalledWith({
        where: { id: 'inbox-1' },
        data: { status: JustificationInboxStatus.READ, readAt: expect.any(Date), justificationId: data.id },
      });
      expect(result.blocks).toEqual(['C', 'D']);
      expect(result.teachers).toEqual([]);
    });

    it('devuelve la justificación existente si la entrada ya fue abierta', async () => {
      prisma.justificationInbox.findUnique.mockResolvedValue({ ...inbox, justificationId: 'just-1' });
      prisma.justification.findUniqueOrThrow.mockResolvedValue(pending);

      const result = await service.openInboxEntry('inbox-1', 'coordinator-2');

      expect(result.id).toBe('just-1');
      expect(prisma.justification.create).not.toHaveBeenCalled();
      expect(prisma.justificationInbox.update).not.toHaveBeenCalled();
    });

    it('rechaza entradas inexistentes', async () => {
      prisma.justificationInbox.findUnique.mockResolvedValue(null);

      await expect(service.openInboxEntry('missing', 'coordinator-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('decide', () => {
    it('rechaza justificaciones inexistentes o ya resueltas', async () => {
      prisma.justification.findUnique.mockResolvedValueOnce(null);
      await expect(service.decide('missing', 'u', JustificationStatus.ACCEPTED)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.justification.findUnique.mockResolvedValueOnce({ ...pending, status: JustificationStatus.ACCEPTED });
      await expect(service.decide('just-1', 'u', JustificationStatus.REJECTED, 'x')).rejects.toThrow(
        'La justificación ya fue resuelta',
      );
      expect(prisma.justification.update).not.toHaveBeenCalled();
    });

    it('rechaza con motivo, guarda historial y notifica solo al estudiante', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.justification.update.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ ...pending, ...data }),
      );
      prisma.teachingAssignment.findMany.mockResolvedValue([{ teacher: { name: 'Prof', email: 'prof@ucn.cl' } }]);

      await service.decide('just-1', 'coordinator-1', JustificationStatus.REJECTED, 'Documento ilegible', 'MEDICAL');

      expect(prisma.justification.update).toHaveBeenCalledWith({
        where: { id: 'just-1' },
        data: expect.objectContaining({
          status: JustificationStatus.REJECTED,
          rejectionReason: 'Documento ilegible',
          reasonCategory: 'MEDICAL',
          decidedById: 'coordinator-1',
          decidedAt: expect.any(Date),
        }),
      });
      expect(prisma.justificationStatusHistory.create).toHaveBeenCalledWith({
        data: {
          justificationId: 'just-1',
          fromStatus: JustificationStatus.PENDING,
          toStatus: JustificationStatus.REJECTED,
          note: 'Documento ilegible',
          changedById: 'coordinator-1',
        },
      });
      expect(notifications.send).toHaveBeenCalledTimes(1);
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'student@alumnos.ucn.cl',
          text: expect.stringContaining('Motivo: Documento ilegible'),
        }),
      );
    });

    it('rechaza un motivo de rechazo compuesto solo por espacios', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);

      await expect(service.decide('just-1', 'u', JustificationStatus.REJECTED, '   ')).rejects.toThrow(
        'Indica el motivo del rechazo',
      );
    });

    it('no guarda motivo de rechazo al aprobar', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.justification.update.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ ...pending, ...data }),
      );

      await service.decide('just-1', 'u', JustificationStatus.ACCEPTED, 'ignorado');

      expect(prisma.justification.update.mock.calls[0][0].data.rejectionReason).toBeNull();
    });

    it('usa profesores históricos del NRC si no hay asignación en el semestre activo', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.justification.update.mockResolvedValue({ ...pending, status: JustificationStatus.ACCEPTED });
      prisma.teachingAssignment.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ teacher: { name: 'Prof. Histórico', email: 'old@ucn.cl' } }]);

      const result = await service.decide('just-1', 'u', JustificationStatus.ACCEPTED);

      expect(result.teachers).toEqual([{ name: 'Prof. Histórico', email: 'old@ucn.cl' }]);
      expect(prisma.teachingAssignment.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { nrc: '10001' } }),
      );
      expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'old@ucn.cl' }));
    });

    it('aprueba aunque no haya profesores asociados, notificando al estudiante', async () => {
      prisma.justification.findUnique.mockResolvedValue({ ...pending, nrc: null });
      prisma.justification.update.mockResolvedValue({ ...pending, nrc: null, status: JustificationStatus.ACCEPTED });

      const result = await service.decide('just-1', 'u', JustificationStatus.ACCEPTED);

      expect(result.teachers).toEqual([]);
      expect(prisma.teachingAssignment.findMany).not.toHaveBeenCalled();
      expect(notifications.send).toHaveBeenCalledTimes(1);
    });

    it('devuelve la decisión guardada aunque falle el envío de correos', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.justification.update.mockResolvedValue({ ...pending, status: JustificationStatus.ACCEPTED });
      notifications.send.mockRejectedValue(new Error('No se pudo enviar la notificación (500)'));

      await expect(service.decide('just-1', 'u', JustificationStatus.ACCEPTED)).resolves.toEqual(
        expect.objectContaining({ id: 'just-1', status: JustificationStatus.ACCEPTED }),
      );
    });
  });

  describe('bloques de horario', () => {
    function scheduleDay(): string | undefined {
      return prisma.courseSchedule.findMany.mock.calls[0]?.[0].where.day;
    }

    it.each([
      ['2026-09-21T00:00:00Z', 'Lunes'],
      ['2026-09-23T00:00:00Z', 'Miércoles'],
      ['2026-09-26T23:59:59Z', 'Sábado'],
    ])('consulta el día de la fecha UTC %s (%s)', async (date, day) => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.justification.update.mockResolvedValue({ ...pending, absenceDate: new Date(date) });

      await service.decide('just-1', 'u', JustificationStatus.ACCEPTED);

      expect(scheduleDay()).toBe(day);
    });

    it('no busca bloques para un domingo', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.justification.update.mockResolvedValue({ ...pending, absenceDate: new Date('2026-09-27T00:00:00Z') });

      const result = await service.decide('just-1', 'u', JustificationStatus.ACCEPTED);

      expect(result.blocks).toEqual([]);
      expect(prisma.courseSchedule.findMany).not.toHaveBeenCalled();
    });

    it('usa el horario histórico si el semestre activo no tiene bloques', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.justification.update.mockResolvedValue(pending);
      prisma.courseSchedule.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ block: 'E' }]);

      const result = await service.decide('just-1', 'u', JustificationStatus.ACCEPTED);

      expect(result.blocks).toEqual(['E']);
    });

    it('devuelve una lista vacía si falla la consulta de horarios', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.justification.update.mockResolvedValue(pending);
      prisma.courseSchedule.findMany.mockRejectedValue(new Error('db down'));

      const result = await service.decide('just-1', 'u', JustificationStatus.ACCEPTED);

      expect(result.blocks).toEqual([]);
    });
  });
});

describe('JustificationsService decisiones concurrentes', () => {
  type Row = { id: string; status: JustificationStatus; nrc: string | null; absenceDate: Date; [key: string]: unknown };

  // Base en memoria que respeta el filtro por estado igual que PostgreSQL.
  function createDatabase(row: Row) {
    let stored = { ...row };
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const matches = (where: { id?: string; status?: JustificationStatus }) =>
      where.id === stored.id && (where.status === undefined || where.status === stored.status);

    const client = {
      justification: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
          await tick();
          return where.id === stored.id ? { ...stored } : null;
        }),
        findFirst: jest.fn(async ({ where }: { where: { id: string; status?: JustificationStatus } }) => {
          await tick();
          return matches(where) ? { ...stored } : null;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string; status?: JustificationStatus }; data: object }) => {
          await tick();
          if (!matches(where)) throw new Error('Record to update not found');
          stored = { ...stored, ...data };
          return { ...stored };
        }),
        updateMany: jest.fn(async ({ where, data }: { where: { id: string; status?: JustificationStatus }; data: object }) => {
          await tick();
          if (!matches(where)) return { count: 0 };
          stored = { ...stored, ...data };
          return { count: 1 };
        }),
      },
      justificationStatusHistory: { create: jest.fn() },
      teachingAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      courseSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    client.$transaction.mockImplementation((operation: (tx: typeof client) => Promise<unknown>) => operation(client));
    return client;
  }

  it('solo una de dos decisiones simultáneas sobre la misma justificación se aplica', async () => {
    const database = createDatabase({
      id: 'just-1',
      status: JustificationStatus.PENDING,
      nrc: '10001',
      absenceDate: new Date('2026-09-23T00:00:00Z'),
      studentEmail: 'student@alumnos.ucn.cl',
      subjectName: 'Biología',
    });
    const service = new JustificationsService(
      database as unknown as PrismaService,
      { send: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
      {} as StorageService,
    );

    const results = await Promise.allSettled([
      service.decide('just-1', 'coordinator-1', JustificationStatus.ACCEPTED),
      service.decide('just-1', 'coordinator-2', JustificationStatus.REJECTED, 'Fuera de plazo'),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(database.justificationStatusHistory.create).toHaveBeenCalledTimes(1);
  });
});
