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
