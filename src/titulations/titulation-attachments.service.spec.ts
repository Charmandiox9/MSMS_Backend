import { NotFoundException } from '@nestjs/common';
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
  originalName: 'acta de prueba.pdf',
  contentType: 'application/pdf',
  size: pdfContent.length,
  createdAt,
};

function createService() {
  const prisma = {
    titulationProcess: {
      findUnique: jest.fn().mockResolvedValue({ id: processId }),
    },
    titulationAttachment: {
      findMany: jest.fn().mockResolvedValue([attachment]),
      create: jest.fn().mockResolvedValue(attachment),
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
  return { service, prisma, storage };
}

describe('TitulationAttachmentsService', () => {
  it('stores a validated file privately and associates its metadata with a process', async () => {
    const { service, prisma, storage } = createService();

    await expect(service.upload(processId, file, 'actor-id')).resolves.toEqual(
      attachment,
    );

    expect(storage.uploadPrivateFile).toHaveBeenCalledWith(
      attachment.originalName,
      attachment.contentType,
      pdfContent,
    );
    expect(prisma.titulationAttachment.create).toHaveBeenCalledWith({
      data: {
        processId,
        storageKey,
        originalName: attachment.originalName,
        contentType: attachment.contentType,
        size: pdfContent.length,
        createdById: 'actor-id',
      },
      select: expect.not.objectContaining({ storageKey: true }),
    });
  });

  it('does not store invalid uploads or uploads for missing processes', async () => {
    const { service, prisma, storage } = createService();

    await expect(
      service.upload(
        processId,
        { ...file, mimetype: 'text/plain' },
        'actor-id',
      ),
    ).rejects.toThrow();
    expect(storage.uploadPrivateFile).not.toHaveBeenCalled();

    prisma.titulationProcess.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.upload(processId, file, 'actor-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it('removes an uploaded object when persisting its metadata fails', async () => {
    const { service, prisma, storage } = createService();
    prisma.titulationAttachment.create.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await expect(service.upload(processId, file, 'actor-id')).rejects.toThrow(
      'database unavailable',
    );
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
