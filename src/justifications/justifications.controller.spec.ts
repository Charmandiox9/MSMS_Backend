import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JustificationStatus } from '@prisma/client';
import { JustificationsController } from './justifications.controller';
import { JustificationsService } from './justifications.service';

describe('JustificationsController', () => {
  let controller: JustificationsController;

  const mockService = {
    receiveFormSubmission: jest.fn(),
    listInbox: jest.fn(),
    listJustifications: jest.fn(),
    openInboxEntry: jest.fn(),
    getEvidenceUrl: jest.fn(),
    decide: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.GOOGLE_FORMS_WEBHOOK_SECRET = 'test-secret';

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JustificationsController],
      providers: [
        {
          provide: JustificationsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<JustificationsController>(JustificationsController);
  });

  afterAll(() => {
    delete process.env.GOOGLE_FORMS_WEBHOOK_SECRET;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listInbox', () => {
    it('returns inbox list from service', async () => {
      const expected = [{ id: 'inbox-1' }];
      mockService.listInbox.mockResolvedValue(expected);

      const result = await controller.listInbox();
      expect(result).toBe(expected);
      expect(mockService.listInbox).toHaveBeenCalledTimes(1);
    });
  });

  describe('list', () => {
    it('calls service with status filter when provided', async () => {
      const expected = [{ id: 'just-1' }];
      mockService.listJustifications.mockResolvedValue(expected);

      const req = { query: { status: 'PENDING' }, user: { id: 'user-1' } } as any;
      const result = await controller.list(req);

      expect(result).toBe(expected);
      expect(mockService.listJustifications).toHaveBeenCalledWith(JustificationStatus.PENDING);
    });

    it('calls service without filter when status is invalid or omitted', async () => {
      const expected = [{ id: 'just-1' }];
      mockService.listJustifications.mockResolvedValue(expected);

      const req = { query: {}, user: { id: 'user-1' } } as any;
      const result = await controller.list(req);

      expect(result).toBe(expected);
      expect(mockService.listJustifications).toHaveBeenCalledWith(undefined);
    });
  });

  describe('open', () => {
    it('delegates to service with authenticated user id', async () => {
      const expected = { id: 'just-1', status: JustificationStatus.PENDING };
      mockService.openInboxEntry.mockResolvedValue(expected);

      const req = { user: { id: 'user-123' } } as any;
      const result = await controller.open('inbox-1', req);

      expect(result).toBe(expected);
      expect(mockService.openInboxEntry).toHaveBeenCalledWith('inbox-1', 'user-123');
    });
  });

  describe('decide', () => {
    it('calls decide service method with validated decision', async () => {
      const expected = { id: 'just-1', status: JustificationStatus.ACCEPTED };
      mockService.decide.mockResolvedValue(expected);

      const req = { user: { id: 'user-123' } } as any;
      const body = {
        status: JustificationStatus.ACCEPTED,
        reasonCategory: 'MEDICAL',
      };

      const result = await controller.decide('just-1', body, req);

      expect(result).toBe(expected);
      expect(mockService.decide).toHaveBeenCalledWith('just-1', 'user-123', JustificationStatus.ACCEPTED, undefined, 'MEDICAL');
    });
  });

  describe('evidenceUrl', () => {
    it('fetches presigned evidence download url', async () => {
      mockService.getEvidenceUrl.mockResolvedValue({ downloadUrl: 'https://storage.example.com/file.pdf' });

      const result = await controller.evidenceUrl('just-1');

      expect(result).toEqual({ downloadUrl: 'https://storage.example.com/file.pdf' });
      expect(mockService.getEvidenceUrl).toHaveBeenCalledWith('just-1');
    });
  });

  describe('receiveFormSubmission', () => {
    it('rejects submissions with invalid secret', () => {
      const submission = {
        externalResponseId: 'resp-1',
        studentEmail: 'student@example.com',
        absenceDate: '2026-09-25',
        nrc: '12345',
        evidenceKey: 'evidence/key.pdf',
        evidenceContentType: 'application/pdf',
      };

      expect(() =>
        controller.receiveFormSubmission('wrong-secret', undefined, submission),
      ).toThrow(UnauthorizedException);
      expect(mockService.receiveFormSubmission).not.toHaveBeenCalled();
    });

    it('accepts submissions with valid header secret', async () => {
      const submission = {
        externalResponseId: 'resp-1',
        studentEmail: 'student@example.com',
        absenceDate: '2026-09-25',
        nrc: '12345',
        evidenceKey: 'evidence/key.pdf',
        evidenceContentType: 'application/pdf',
      };
      mockService.receiveFormSubmission.mockResolvedValue({ id: 'inbox-1' });

      const result = await controller.receiveFormSubmission('test-secret', undefined, submission);

      expect(result).toEqual({ id: 'inbox-1' });
      expect(mockService.receiveFormSubmission).toHaveBeenCalledWith(submission);
    });
  });
});
