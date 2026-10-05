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
    assistantship: { findMany: jest.fn().mockResolvedValue([]) },
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
      updateMany: jest.fn(),
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
    mockPrisma.assistantship.findMany.mockResolvedValue([]);

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
      const mockEntries = [
        {
          id: 'inbox-1',
          status: JustificationInboxStatus.UNREAD,
          nrc: '10002',
          absenceDate: new Date('2026-09-22T00:00:00Z'),
        },
      ];
      mockPrisma.justificationInbox.findMany.mockResolvedValue(mockEntries);
      mockPrisma.courseSchedule.findMany.mockResolvedValue([
        {
          nrc: '10002',
          day: 'Martes',
          block: 'C',
          semester: { isActive: true },
        },
      ]);

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
        {
          nrc: '10002',
          teacherId: 'teacher-1',
          teacher: { name: 'Prof. Gomez', email: 'gomez@ucn.cl' },
          semester: { isActive: true },
        },
      ]);
      mockPrisma.courseSchedule.findMany.mockResolvedValue([
        {
          nrc: '10002',
          day: 'Martes',
          block: 'C',
          semester: { isActive: true },
        },
      ]);

      const result = await service.listJustifications();

      expect(result).toHaveLength(1);
      expect(result[0].teachers).toEqual([
        { name: 'Prof. Gomez', email: 'gomez@ucn.cl' },
      ]);
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

      await expect(service.getEvidenceUrl('missing-id')).rejects.toThrow(
        NotFoundException,
      );
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
      expect(mockStorage.createPresignedDownload).toHaveBeenCalledWith(
        'uploads/evidence.pdf',
      );
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
      mockPrisma.justification.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.justification.findUniqueOrThrow.mockResolvedValue({
        ...existing,
        status: JustificationStatus.ACCEPTED,
        reasonCategory: 'MEDICAL',
      });
      mockPrisma.teachingAssignment.findMany.mockResolvedValue([
        {
          nrc: '12345',
          teacherId: 'teacher-1',
          teacher: { name: 'Prof. Gomez', email: 'gomez@ucn.cl' },
          semester: { isActive: true },
        },
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
    assistantship: { findMany: jest.fn().mockResolvedValue([]) },
    teachingAssignment: { findFirst: jest.fn(), findMany: jest.fn() },
    courseSchedule: { findMany: jest.fn() },
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
      updateMany: jest.fn(),
    },
    justificationStatusHistory: { create: jest.fn() },
    $transaction: jest.fn((operation: (client: unknown) => Promise<unknown>) =>
      operation(prisma),
    ),
  };
  const notifications = { send: jest.fn() };
  const teacher = (
    nrc: string,
    id: string,
    email: string,
    isActive = true,
  ) => ({
    nrc,
    teacherId: id,
    teacher: { name: id, email },
    semester: { isActive },
  });
  const schedule = (
    nrc: string,
    day: string,
    block: string,
    isActive = true,
  ) => ({ nrc, day, block, semester: { isActive } });

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
    prisma.assistantship.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      (operation: (client: unknown) => Promise<unknown>) => operation(prisma),
    );
    prisma.teachingAssignment.findMany.mockResolvedValue([]);
    prisma.courseSchedule.findMany.mockResolvedValue([]);
    notifications.send.mockResolvedValue(undefined);
    // updateMany guarda los datos de la decisión; findUniqueOrThrow devuelve la fila resultante.
    let saved: object = {};
    prisma.justification.updateMany.mockImplementation(
      ({ data }: { data: object }) => {
        saved = data;
        return Promise.resolve({ count: 1 });
      },
    );
    prisma.justification.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ ...pending, ...saved }),
    );
    service = new JustificationsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      {} as StorageService,
    );
  });

  describe('receiveFormSubmission', () => {
    it('usa la asignatura del semestre activo según el NRC y es idempotente por respuesta', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue({
        course: { name: 'Biología', code: 'BIO101' },
      });
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

      await service.receiveFormSubmission({
        ...submission,
        subjectName: '  Química  ',
        subjectCode: 'QUI',
      });

      expect(prisma.justificationInbox.upsert.mock.calls[0][0].create).toEqual(
        expect.objectContaining({ subjectName: 'Química', subjectCode: 'QUI' }),
      );
    });

    it('rechaza un NRC desconocido sin nombre de asignatura', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue(null);

      await expect(
        service.receiveFormSubmission({ ...submission, subjectName: '   ' }),
      ).rejects.toThrow('El NRC no corresponde a una asignatura activa');
      expect(prisma.justificationInbox.upsert).not.toHaveBeenCalled();
    });

    it('rechaza una fecha de inasistencia inválida', async () => {
      await expect(
        service.receiveFormSubmission({
          ...submission,
          absenceDate: '31/02/2026',
        }),
      ).rejects.toThrow('La fecha de inasistencia no es válida');
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
      prisma.justification.create.mockImplementation(
        ({ data }: { data: object }) => Promise.resolve(data),
      );
      prisma.courseSchedule.findMany.mockResolvedValue([
        schedule('10001', 'Miércoles', 'C'),
        schedule('10001', 'Miércoles', 'D'),
      ]);

      const result = await service.openInboxEntry('inbox-1', 'coordinator-1');

      const data = prisma.justification.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          sourceResponseId: 'resp-1',
          createdById: 'coordinator-1',
          evidenceKey: 'uploads/evidence.pdf',
          history: {
            create: {
              toStatus: JustificationStatus.PENDING,
              changedById: 'coordinator-1',
            },
          },
        }),
      );
      expect(prisma.justificationInbox.update).toHaveBeenCalledWith({
        where: { id: 'inbox-1' },
        data: {
          status: JustificationInboxStatus.READ,
          readAt: expect.any(Date),
          justificationId: data.id,
        },
      });
      expect(result.blocks).toEqual(['C', 'D']);
      expect(result.teachers).toEqual([]);
    });

    it('devuelve la justificación existente si la entrada ya fue abierta', async () => {
      prisma.justificationInbox.findUnique.mockResolvedValue({
        ...inbox,
        justificationId: 'just-1',
      });
      prisma.justification.findUniqueOrThrow.mockResolvedValue(pending);

      const result = await service.openInboxEntry('inbox-1', 'coordinator-2');

      expect(result.id).toBe('just-1');
      expect(prisma.justification.create).not.toHaveBeenCalled();
      expect(prisma.justificationInbox.update).not.toHaveBeenCalled();
    });

    it('rechaza entradas inexistentes', async () => {
      prisma.justificationInbox.findUnique.mockResolvedValue(null);

      await expect(
        service.openInboxEntry('missing', 'coordinator-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('decide', () => {
    it.each<[string[] | undefined, number, string, boolean]>([
      [undefined, 3, '2026-12-31', true],
      [['A'], 3, '2026-12-31', true],
      [['B'], 3, '2026-12-31', false],
      [undefined, 4, '2026-12-31', false],
      [undefined, 3, '2026-09-22', false],
    ])(
      'notifica al ayudante solo si coinciden fecha, día y bloque (%j)',
      async (absenceBlocks, weekday, end, expected) => {
        const row = {
          ...pending,
          absenceBlocks,
          status: JustificationStatus.ACCEPTED,
        };
        prisma.justification.findUnique.mockResolvedValue(pending);
        prisma.justification.findUniqueOrThrow.mockResolvedValue(row);
        prisma.assistantship.findMany.mockResolvedValue([
          {
            teachingAssignment: { nrc: '10001' },
            startsOn: new Date('2026-08-01'),
            endsOn: new Date(end),
            approval: {
              assistant: { name: 'Ayudante', email: 'assistant@example.test' },
            },
            schedules: [{ weekday, startsAtMinute: 490, endsAtMinute: 580 }],
          },
        ]);
        const result = await service.decide(
          'just-1',
          'u',
          JustificationStatus.ACCEPTED,
        );
        expect(result.assistants).toHaveLength(expected ? 1 : 0);
        const recipients = notifications.send.mock.calls.map(
          ([message]: [{ to: string }]) => message.to,
        );
        expect(recipients.includes('assistant@example.test')).toBe(expected);
      },
    );

    it('sin bloque avisa a todos los ayudantes del día y deduplica dentro de cada rol', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.teachingAssignment.findMany.mockResolvedValue([
        teacher('10001', 't', 'helper1@example.test'),
      ]);
      const record = (
        email: string,
        start: number,
        end: number,
        nrc = '10001',
      ) => ({
        teachingAssignment: { nrc },
        startsOn: new Date('2026-08-01'),
        endsOn: null,
        approval: { assistant: { name: 'Ayudante', email } },
        schedules: [{ weekday: 3, startsAtMinute: start, endsAtMinute: end }],
      });
      prisma.assistantship.findMany.mockResolvedValue([
        record('helper1@example.test', 490, 580),
        record('helper1@example.test', 490, 580),
        record('helper2@example.test', 1290, 1380),
        record('other@example.test', 490, 580, '99999'),
      ]);
      await service.decide('just-1', 'u', JustificationStatus.ACCEPTED);
      const recipients = notifications.send.mock.calls.map(
        ([message]: [{ to: string }]) => message.to,
      );
      expect(recipients.sort()).toEqual(
        [
          pending.studentEmail,
          'helper1@example.test',
          'helper1@example.test',
          'helper2@example.test',
        ].sort(),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'helper2@example.test',
          text: expect.stringContaining('2026-09-23'),
        }),
      );
    });

    it('envía los tres mensajes por rol aunque alumno, profesor y ayudante compartan correo', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.teachingAssignment.findMany.mockResolvedValue([
        teacher('10001', 'Docente', pending.studentEmail),
      ]);
      const helper = {
        teachingAssignment: { nrc: '10001' },
        startsOn: new Date('2026-08-01'),
        endsOn: null,
        approval: {
          assistant: { name: 'Ayudante', email: pending.studentEmail },
        },
        schedules: [{ weekday: 3, startsAtMinute: 490, endsAtMinute: 580 }],
      };
      prisma.assistantship.findMany.mockResolvedValue([helper, helper]);
      await service.decide('just-1', 'u', JustificationStatus.ACCEPTED);
      expect(notifications.send).toHaveBeenCalledTimes(3);
      const messages = notifications.send.mock.calls.map(
        ([message]: [{ to: string; text: string }]) => message,
      );
      expect(
        messages.every((message) => message.to === pending.studentEmail),
      ).toBe(true);
      expect(
        messages.filter((message) => message.text.includes('Tu justificación')),
      ).toHaveLength(1);
      expect(
        messages.filter((message) => message.text.includes('como docente')),
      ).toHaveLength(1);
      expect(
        messages.filter((message) => message.text.includes('como ayudante')),
      ).toHaveLength(1);
    });

    it('no notifica ayudantes cuando la justificación se rechaza', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.assistantship.findMany.mockResolvedValue([
        {
          teachingAssignment: { nrc: '10001' },
          startsOn: new Date('2026-08-01'),
          endsOn: null,
          approval: {
            assistant: { name: 'Ayudante', email: 'assistant@example.test' },
          },
          schedules: [{ weekday: 3, startsAtMinute: 490, endsAtMinute: 580 }],
        },
      ]);
      await service.decide(
        'just-1',
        'u',
        JustificationStatus.REJECTED,
        'Motivo',
      );
      expect(notifications.send).toHaveBeenCalledTimes(1);
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: pending.studentEmail }),
      );
    });

    it('rechaza justificaciones inexistentes o ya resueltas', async () => {
      prisma.justification.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.decide('missing', 'u', JustificationStatus.ACCEPTED),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.justification.findUnique.mockResolvedValueOnce({
        ...pending,
        status: JustificationStatus.ACCEPTED,
      });
      await expect(
        service.decide('just-1', 'u', JustificationStatus.REJECTED, 'x'),
      ).rejects.toThrow('La justificación ya fue resuelta');
      expect(prisma.justification.updateMany).not.toHaveBeenCalled();
    });

    it('no aplica la decisión si otra la resolvió entre la validación y la escritura', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.justification.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.decide('just-1', 'u', JustificationStatus.ACCEPTED),
      ).rejects.toThrow('La justificación ya fue resuelta');
      expect(prisma.justificationStatusHistory.create).not.toHaveBeenCalled();
      expect(notifications.send).not.toHaveBeenCalled();
    });

    it('rechaza con motivo, guarda historial y notifica solo al estudiante', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.teachingAssignment.findMany.mockResolvedValue([
        teacher('10001', 'prof', 'prof@ucn.cl'),
      ]);

      await service.decide(
        'just-1',
        'coordinator-1',
        JustificationStatus.REJECTED,
        'Documento ilegible',
        'MEDICAL',
      );

      expect(prisma.justification.updateMany).toHaveBeenCalledWith({
        where: { id: 'just-1', status: JustificationStatus.PENDING },
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

      await expect(
        service.decide('just-1', 'u', JustificationStatus.REJECTED, '   '),
      ).rejects.toThrow('Indica el motivo del rechazo');
    });

    it('no guarda motivo de rechazo al aprobar', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);

      await service.decide(
        'just-1',
        'u',
        JustificationStatus.ACCEPTED,
        'ignorado',
      );

      expect(
        prisma.justification.updateMany.mock.calls[0][0].data.rejectionReason,
      ).toBeNull();
    });

    it('usa profesores históricos del NRC si no hay asignación en el semestre activo', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.teachingAssignment.findMany.mockResolvedValue([
        teacher('10001', 'Prof. Histórico', 'old@ucn.cl', false),
      ]);

      const result = await service.decide(
        'just-1',
        'u',
        JustificationStatus.ACCEPTED,
      );

      expect(result.teachers).toEqual([
        { name: 'Prof. Histórico', email: 'old@ucn.cl' },
      ]);
      expect(prisma.teachingAssignment.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.teachingAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { nrc: { in: ['10001'] } } }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'old@ucn.cl' }),
      );
    });

    it('prefiere a los profesores del semestre activo sobre los históricos', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.teachingAssignment.findMany.mockResolvedValue([
        teacher('10001', 'Prof. Anterior', 'old@ucn.cl', false),
        teacher('10001', 'Prof. Actual', 'now@ucn.cl'),
      ]);

      const result = await service.decide(
        'just-1',
        'u',
        JustificationStatus.ACCEPTED,
      );

      expect(result.teachers).toEqual([
        { name: 'Prof. Actual', email: 'now@ucn.cl' },
      ]);
    });

    it('aprueba aunque no haya profesores asociados, notificando al estudiante', async () => {
      prisma.justification.findUnique.mockResolvedValue({
        ...pending,
        nrc: null,
      });
      prisma.justification.findUniqueOrThrow.mockResolvedValue({
        ...pending,
        nrc: null,
        status: JustificationStatus.ACCEPTED,
      });

      const result = await service.decide(
        'just-1',
        'u',
        JustificationStatus.ACCEPTED,
      );

      expect(result.teachers).toEqual([]);
      expect(prisma.teachingAssignment.findMany).not.toHaveBeenCalled();
      expect(notifications.send).toHaveBeenCalledTimes(1);
    });

    it('devuelve la decisión guardada aunque falle el envío de correos', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      notifications.send.mockRejectedValue(
        new Error('No se pudo enviar la notificación (500)'),
      );

      await expect(
        service.decide('just-1', 'u', JustificationStatus.ACCEPTED),
      ).resolves.toEqual(
        expect.objectContaining({
          id: 'just-1',
          status: JustificationStatus.ACCEPTED,
        }),
      );
    });

    it('si falla un correo, igual envía los demás', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.teachingAssignment.findMany.mockResolvedValue([
        teacher('10001', 'a', 'a@ucn.cl'),
        teacher('10001', 'b', 'b@ucn.cl'),
      ]);
      notifications.send.mockImplementation(({ to }: { to: string }) =>
        to === 'a@ucn.cl'
          ? Promise.reject(new Error('rebote'))
          : Promise.resolve(),
      );

      await service.decide('just-1', 'u', JustificationStatus.ACCEPTED);

      expect(
        notifications.send.mock.calls.map(([message]) => message.to).sort(),
      ).toEqual(['a@ucn.cl', 'b@ucn.cl', 'student@alumnos.ucn.cl']);
    });
  });

  describe('listados en lote', () => {
    const row = (id: string, nrc: string, date: string) => ({
      ...pending,
      id,
      nrc,
      absenceDate: new Date(date),
    });

    it('usa un número fijo de consultas y asigna profesores y bloques a cada fila', async () => {
      prisma.justification.findMany.mockResolvedValue([
        row('j1', '10001', '2026-09-23T00:00:00Z'),
        row('j2', '10002', '2026-09-24T00:00:00Z'),
        row('j3', '10001', '2026-09-23T00:00:00Z'),
        row('j4', '10003', '2026-09-22T00:00:00Z'),
      ]);
      prisma.teachingAssignment.findMany.mockResolvedValue([
        teacher('10001', 't1', 'uno@ucn.cl'),
        teacher('10001', 't0', 'viejo@ucn.cl', false),
        teacher('10002', 't2', 'dos@ucn.cl'),
        teacher('10003', 't3', 'tres@ucn.cl', false),
      ]);
      prisma.courseSchedule.findMany.mockResolvedValue([
        schedule('10001', 'Miércoles', 'C'),
        schedule('10001', 'Miércoles', 'X', false),
        schedule('10002', 'Jueves', 'A'),
        schedule('10002', 'Miércoles', 'Z'),
        schedule('10003', 'Martes', 'F', false),
      ]);

      const result = await service.listJustifications();

      expect(prisma.teachingAssignment.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.teachingAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { nrc: { in: ['10001', '10002', '10003'] } },
        }),
      );
      expect(prisma.courseSchedule.findMany).toHaveBeenCalledTimes(1);
      expect(
        result.map(({ id, teachers, blocks }) => ({
          id,
          teachers: teachers.map((t) => t.email),
          blocks,
        })),
      ).toEqual([
        { id: 'j1', teachers: ['uno@ucn.cl'], blocks: ['C'] },
        { id: 'j2', teachers: ['dos@ucn.cl'], blocks: ['A'] },
        { id: 'j3', teachers: ['uno@ucn.cl'], blocks: ['C'] },
        { id: 'j4', teachers: ['tres@ucn.cl'], blocks: ['F'] },
      ]);
    });

    it('no repite un profesor asignado varias veces al mismo NRC', async () => {
      prisma.justification.findMany.mockResolvedValue([
        row('j1', '10001', '2026-09-23T00:00:00Z'),
      ]);
      prisma.teachingAssignment.findMany.mockResolvedValue([
        teacher('10001', 't1', 'uno@ucn.cl'),
        teacher('10001', 't1', 'uno@ucn.cl'),
      ]);

      const [result] = await service.listJustifications();

      expect(result.teachers).toEqual([{ name: 't1', email: 'uno@ucn.cl' }]);
    });

    it('la bandeja carga los bloques de todas las entradas en una consulta', async () => {
      prisma.justificationInbox.findMany.mockResolvedValue([
        {
          id: 'i1',
          nrc: '10001',
          absenceDate: new Date('2026-09-23T00:00:00Z'),
        },
        {
          id: 'i2',
          nrc: '10002',
          absenceDate: new Date('2026-09-24T00:00:00Z'),
        },
      ]);
      prisma.courseSchedule.findMany.mockResolvedValue([
        schedule('10001', 'Miércoles', 'C'),
        schedule('10002', 'Jueves', 'A'),
      ]);

      const result = await service.listInbox();

      expect(prisma.courseSchedule.findMany).toHaveBeenCalledTimes(1);
      expect(result.map(({ id, blocks }) => ({ id, blocks }))).toEqual([
        { id: 'i1', blocks: ['C'] },
        { id: 'i2', blocks: ['A'] },
      ]);
    });

    it('sin filas no consulta profesores ni horarios', async () => {
      prisma.justification.findMany.mockResolvedValue([]);

      await expect(service.listJustifications()).resolves.toEqual([]);
      expect(prisma.teachingAssignment.findMany).not.toHaveBeenCalled();
      expect(prisma.courseSchedule.findMany).not.toHaveBeenCalled();
    });
  });

  describe('bloques de horario', () => {
    function scheduleDays(): string[] | undefined {
      return prisma.courseSchedule.findMany.mock.calls[0]?.[0].where.day.in;
    }

    it.each([
      ['2026-09-21T00:00:00Z', 'Lunes'],
      ['2026-09-23T00:00:00Z', 'Miércoles'],
      ['2026-09-26T23:59:59Z', 'Sábado'],
    ])('consulta el día de la fecha UTC %s (%s)', async (date, day) => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.justification.findUniqueOrThrow.mockResolvedValue({
        ...pending,
        absenceDate: new Date(date),
      });

      await service.decide('just-1', 'u', JustificationStatus.ACCEPTED);

      expect(scheduleDays()).toEqual([day]);
    });

    it('no busca bloques para un domingo', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.justification.findUniqueOrThrow.mockResolvedValue({
        ...pending,
        absenceDate: new Date('2026-09-27T00:00:00Z'),
      });

      const result = await service.decide(
        'just-1',
        'u',
        JustificationStatus.ACCEPTED,
      );

      expect(result.blocks).toEqual([]);
      expect(prisma.courseSchedule.findMany).not.toHaveBeenCalled();
    });

    it('usa el horario histórico si el semestre activo no tiene bloques', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.courseSchedule.findMany.mockResolvedValue([
        schedule('10001', 'Miércoles', 'E', false),
      ]);

      const result = await service.decide(
        'just-1',
        'u',
        JustificationStatus.ACCEPTED,
      );

      expect(result.blocks).toEqual(['E']);
    });

    it('devuelve una lista vacía si falla la consulta de horarios', async () => {
      prisma.justification.findUnique.mockResolvedValue(pending);
      prisma.courseSchedule.findMany.mockRejectedValue(new Error('db down'));

      const result = await service.decide(
        'just-1',
        'u',
        JustificationStatus.ACCEPTED,
      );

      expect(result.blocks).toEqual([]);
    });
  });
});

describe('JustificationsService decisiones concurrentes', () => {
  type Row = {
    id: string;
    status: JustificationStatus;
    nrc: string | null;
    absenceDate: Date;
    [key: string]: unknown;
  };

  // Base en memoria que respeta el filtro por estado igual que PostgreSQL.
  function createDatabase(row: Row) {
    let stored = { ...row };
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const matches = (where: { id?: string; status?: JustificationStatus }) =>
      where.id === stored.id &&
      (where.status === undefined || where.status === stored.status);

    const client = {
      justification: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
          await tick();
          return where.id === stored.id ? { ...stored } : null;
        }),
        findUniqueOrThrow: jest.fn(
          async ({ where }: { where: { id: string } }) => {
            await tick();
            if (where.id !== stored.id) throw new Error('No record found');
            return { ...stored };
          },
        ),
        findFirst: jest.fn(
          async ({
            where,
          }: {
            where: { id: string; status?: JustificationStatus };
          }) => {
            await tick();
            return matches(where) ? { ...stored } : null;
          },
        ),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; status?: JustificationStatus };
            data: object;
          }) => {
            await tick();
            if (!matches(where)) throw new Error('Record to update not found');
            stored = { ...stored, ...data };
            return { ...stored };
          },
        ),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; status?: JustificationStatus };
            data: object;
          }) => {
            await tick();
            if (!matches(where)) return { count: 0 };
            stored = { ...stored, ...data };
            return { count: 1 };
          },
        ),
      },
      justificationStatusHistory: { create: jest.fn() },
      teachingAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      courseSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      assistantship: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    client.$transaction.mockImplementation(
      (operation: (tx: typeof client) => Promise<unknown>) => operation(client),
    );
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
      {
        send: jest.fn().mockResolvedValue(undefined),
      } as unknown as NotificationsService,
      {} as StorageService,
    );

    const results = await Promise.allSettled([
      service.decide('just-1', 'coordinator-1', JustificationStatus.ACCEPTED),
      service.decide(
        'just-1',
        'coordinator-2',
        JustificationStatus.REJECTED,
        'Fuera de plazo',
      ),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(database.justificationStatusHistory.create).toHaveBeenCalledTimes(1);
  });
});
