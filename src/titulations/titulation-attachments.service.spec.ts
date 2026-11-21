import { NotFoundException } from '@nestjs/common';
import {
  TitulationDocumentKind,
  TitulationDocumentStatus,
} from '@prisma/client';
import { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TitulationAttachmentsService } from './titulation-attachments.service';
import type { TitulationUploadFile } from './titulation-attachments.util';

const processId = '11111111-1111-4111-8111-111111111111';
const attachmentId = '22222222-2222-4222-8222-222222222222';
const storageKey = 'titulation-attachments/opaque-key.pdf';
const createdAt = new Date('2026-11-18T12:00:00.000Z');
const pdfContent = Buffer.from('%PDF-1.7\nexample');
const file: TitulationUploadFile = {
  originalname: 'C:\\fakepath\\acta de prueba.pdf',
  mimetype: 'application/pdf',
  buffer: pdfContent,
  size: pdfContent.length,
};
const attachment = {
  id: attachmentId,
  documentKind: TitulationDocumentKind.ACTA,
  originalName: 'acta de prueba.pdf',
  contentType: 'application/pdf',
  size: pdfContent.length,
  createdAt,
};

function createService() {
  const transactionClient = {
    titulationProcess: {
      update: jest.fn().mockResolvedValue({ id: processId }),
    },
    titulationAttachment: {
      create: jest.fn().mockResolvedValue(attachment),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      async (
        operation: (client: typeof transactionClient) => Promise<unknown>,
      ) => operation(transactionClient),
    ),
    titulationProcess: {
      findUnique: jest.fn().mockResolvedValue({ id: processId }),
    },
    titulationAttachment: {
      findMany: jest.fn().mockResolvedValue([attachment]),
      delete: jest.fn().mockResolvedValue({ id: attachmentId }),
      findFirst: jest.fn().mockResolvedValue({
        storageKey,
        originalName: attachment.originalName,
      }),
    },
  };
  const storage = {
    uploadPrivateFile: jest.fn().mockResolvedValue(storageKey),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    downloadFile: jest.fn().mockResolvedValue({
      body: Readable.from([pdfContent]),
      length: pdfContent.length,
    }),
  };
  const service = new TitulationAttachmentsService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
  );
  return { service, prisma, storage, transactionClient };
}

describe('TitulationAttachmentsService', () => {
  it('stores a validated file privately and associates its metadata with a process', async () => {
    const { service, storage, transactionClient } = createService();

    await expect(
      service.upload(
        processId,
        file,
        TitulationDocumentKind.ACTA,
        TitulationDocumentStatus.RECEIVED,
        'actor-id',
      ),
    ).resolves.toEqual(attachment);

    expect(storage.uploadPrivateFile).toHaveBeenCalledWith(
      attachment.originalName,
      attachment.contentType,
      pdfContent,
    );
    expect(transactionClient.titulationAttachment.create).toHaveBeenCalledWith({
      data: {
        processId,
        documentKind: TitulationDocumentKind.ACTA,
        storageKey,
        originalName: attachment.originalName,
        contentType: attachment.contentType,
        size: pdfContent.length,
        createdById: 'actor-id',
      },
      select: expect.not.objectContaining({ storageKey: true }),
    });
    expect(transactionClient.titulationProcess.update).toHaveBeenCalledWith({
      where: { id: processId },
      data: {
        actaStatus: TitulationDocumentStatus.RECEIVED,
        updatedById: 'actor-id',
      },
      select: { id: true },
    });
  });

  it.each([
    [TitulationDocumentKind.DEFENSE_ANNEXES, 'defenseAnnexesStatus'],
    [TitulationDocumentKind.THESIS_SUMMARY, 'thesisSummaryStatus'],
    [TitulationDocumentKind.LIBRARY_FORM, 'libraryFormStatus'],
    [TitulationDocumentKind.ACTA, 'actaStatus'],
    [TitulationDocumentKind.EVALUATIONS, 'evaluationsStatus'],
  ] as const)(
    'marks %s as received after the attachment is stored',
    async (documentKind, statusField) => {
      const { service, transactionClient } = createService();

      await service.upload(
        processId,
        file,
        documentKind,
        TitulationDocumentStatus.PREPARED,
        'actor-id',
      );

      expect(transactionClient.titulationProcess.update).toHaveBeenCalledWith({
        where: { id: processId },
        data: {
          [statusField]: TitulationDocumentStatus.PREPARED,
          updatedById: 'actor-id',
        },
        select: { id: true },
      });
    },
  );

  it('does not store invalid uploads or uploads for missing processes', async () => {
    const { service, prisma, storage } = createService();

    await expect(
      service.upload(
        processId,
        { ...file, mimetype: 'text/plain' },
        TitulationDocumentKind.ACTA,
        TitulationDocumentStatus.RECEIVED,
        'actor-id',
      ),
    ).rejects.toThrow();
    expect(storage.uploadPrivateFile).not.toHaveBeenCalled();

    prisma.titulationProcess.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.upload(
        processId,
        file,
        TitulationDocumentKind.ACTA,
        TitulationDocumentStatus.RECEIVED,
        'actor-id',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it('removes an uploaded object when persisting its metadata fails', async () => {
    const { service, storage, transactionClient } = createService();
    transactionClient.titulationProcess.update.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await expect(
      service.upload(
        processId,
        file,
        TitulationDocumentKind.ACTA,
        TitulationDocumentStatus.RECEIVED,
        'actor-id',
      ),
    ).rejects.toThrow('database unavailable');
    expect(storage.deleteFile).toHaveBeenCalledWith(storageKey);
  });

  it('lists only public attachment metadata for the associated process', async () => {
    const { service, prisma } = createService();

    await expect(service.list(processId)).resolves.toEqual([attachment]);
    expect(prisma.titulationAttachment.findMany).toHaveBeenCalledWith({
      where: { processId },
      select: expect.not.objectContaining({ storageKey: true }),
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  });

  it('removes each private file and its metadata for a process', async () => {
    const { service, prisma, storage } = createService();
    prisma.titulationAttachment.findMany.mockResolvedValueOnce([
      { storageKey },
      { storageKey: 'titulation-attachments/another-opaque-key.docx' },
    ]);

    await service.deleteForProcess(processId);

    expect(prisma.titulationAttachment.findMany).toHaveBeenCalledWith({
      where: { processId },
      select: { storageKey: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(storage.deleteFile).toHaveBeenNthCalledWith(1, storageKey);
    expect(storage.deleteFile).toHaveBeenNthCalledWith(
      2,
      'titulation-attachments/another-opaque-key.docx',
    );
    expect(prisma.titulationAttachment.delete).toHaveBeenNthCalledWith(1, {
      where: { storageKey },
      select: { id: true },
    });
    expect(prisma.titulationAttachment.delete).toHaveBeenNthCalledWith(2, {
      where: { storageKey: 'titulation-attachments/another-opaque-key.docx' },
      select: { id: true },
    });
  });

  it('opens an attachment only when it belongs to the requested process', async () => {
    const { service, prisma, storage } = createService();
    const abort = new AbortController();

    const opened = await service.open(processId, attachmentId, abort.signal);
    expect(opened).toMatchObject({
      originalName: attachment.originalName,
      length: pdfContent.length,
    });
    expect(prisma.titulationAttachment.findFirst).toHaveBeenCalledWith({
      where: { id: attachmentId, processId },
      select: { storageKey: true, originalName: true },
    });
    expect(storage.downloadFile).toHaveBeenCalledWith(storageKey, abort.signal);

    prisma.titulationAttachment.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.open(processId, attachmentId, abort.signal),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.downloadFile).toHaveBeenCalledTimes(1);
  });
});
