import { AcademicImportStatus, AcademicImportType } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { testPiiCrypto } from '../privacy/pii-test-config';
import { AcademicImportsService } from './academic-imports.service';
import { AcademicImportQueueService } from './academic-import-queue.service';

describe('AcademicImportQueueService', () => {
  const crypto = testPiiCrypto();
  const create = jest.fn();
  const findUnique = jest.fn();
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    academicImportJob: { create, findUnique, updateMany },
    $transaction: jest.fn().mockResolvedValue(null),
  } as unknown as PrismaService;
  const imports = {} as AcademicImportsService;
  const service = new AcademicImportQueueService(prisma, crypto, imports);

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({
      id: 'job-id',
      status: AcademicImportStatus.QUEUED,
    });
  });

  it('persists the workbook encrypted and returns immediately with a job id', async () => {
    const input = { fileBase64: 'cHJvamVjdA==' };
    const response = await service.enqueue(
      AcademicImportType.PROJECTS,
      input,
      'user-1',
    );

    expect(response).toEqual({ id: expect.any(String), status: 'QUEUED' });
    const payload = create.mock.calls[0][0].data.payload as string;
    expect(payload).not.toContain(input.fileBase64);
    expect(
      crypto.decrypt(payload, `AcademicImportJob.${response.id}.payload`),
    ).toBe(JSON.stringify(input));
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: response.id,
        type: AcademicImportType.PROJECTS,
        requestedById: 'user-1',
      }),
      select: { id: true, status: true, createdAt: true },
    });
  });

  it('returns only the public job status fields', async () => {
    findUnique.mockResolvedValue({
      id: 'job-id',
      type: AcademicImportType.PROJECTS,
      status: AcademicImportStatus.QUEUED,
      result: null,
      error: null,
    });
    await expect(service.getStatus('job-id')).resolves.toMatchObject({
      id: 'job-id',
      status: 'QUEUED',
    });
    expect(findUnique.mock.calls[0][0].select).not.toHaveProperty('payload');
  });

  it('returns not found for an unknown job', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.getStatus('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
