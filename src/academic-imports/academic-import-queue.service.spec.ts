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

  it('uses recent activity instead of job start time when recovering interrupted jobs', async () => {
    jest.useFakeTimers();
    try {
      await service.onModuleInit();
      expect(updateMany.mock.calls[0][0].where).toHaveProperty('updatedAt');
      expect(updateMany.mock.calls[0][0].where).not.toHaveProperty('startedAt');
    } finally {
      await service.onModuleDestroy();
      jest.useRealTimers();
    }
  });

  it('heartbeats a long import and waits for it before shutting down', async () => {
    jest.useFakeTimers();
    let finish: (value: {
      imported: number;
      skipped: number;
      errors: never[];
      duplicates: never[];
    }) => void = () => undefined;
    const pendingImport = new Promise<{
      imported: number;
      skipped: number;
      errors: never[];
      duplicates: never[];
    }>((resolve) => {
      finish = resolve;
    });
    const activity = jest.fn().mockResolvedValue({ count: 1 });
    const save = jest.fn().mockResolvedValue({});
    const job = {
      id: 'long-job',
      type: AcademicImportType.PROJECTS,
      payload: crypto.encrypt(
        JSON.stringify({ fileBase64: 'test' }),
        'AcademicImportJob.long-job.payload',
      ),
    };
    const claim = jest.fn().mockResolvedValueOnce(job).mockResolvedValue(null);
    const worker = new AcademicImportQueueService(
      {
        $transaction: claim,
        academicImportJob: { updateMany: activity, update: save },
      } as unknown as PrismaService,
      crypto,
      {
        importProjects: () => pendingImport,
      } as unknown as AcademicImportsService,
    );
    try {
      await worker.onModuleInit();
      await jest.advanceTimersByTimeAsync(30_000);
      expect(activity).toHaveBeenCalledWith({
        where: { id: 'long-job', status: 'PROCESSING' },
        data: { updatedAt: expect.any(Date) },
      });
      let stopped = false;
      const shutdown = worker.onModuleDestroy().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);
      finish({ imported: 0, skipped: 0, errors: [], duplicates: [] });
      await shutdown;
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED', payload: null }),
        }),
      );
      const calls = activity.mock.calls.length;
      await jest.advanceTimersByTimeAsync(60_000);
      expect(activity).toHaveBeenCalledTimes(calls);
    } finally {
      finish({ imported: 0, skipped: 0, errors: [], duplicates: [] });
      await worker.onModuleDestroy();
      jest.useRealTimers();
    }
  });

  it('waits for an in-flight database claim before shutting down', async () => {
    let finishClaim: (value: null) => void = () => undefined;
    const pendingClaim = new Promise<null>((resolve) => {
      finishClaim = resolve;
    });
    const worker = new AcademicImportQueueService(
      {
        $transaction: jest.fn().mockReturnValue(pendingClaim),
        academicImportJob: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as unknown as PrismaService,
      crypto,
      imports,
    );
    await worker.onModuleInit();
    let stopped = false;
    const shutdown = worker.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finishClaim(null);
    await shutdown;
    expect(stopped).toBe(true);
  });

  it('rechecks interrupted jobs after startup so a quick restart does not strand recent work', async () => {
    jest.useFakeTimers();
    const recovery = jest.fn().mockResolvedValue({ count: 0 });
    const worker = new AcademicImportQueueService(
      {
        $transaction: jest.fn().mockResolvedValue(null),
        academicImportJob: { updateMany: recovery },
      } as unknown as PrismaService,
      crypto,
      imports,
    );
    try {
      await worker.onModuleInit();
      expect(recovery).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(recovery).toHaveBeenCalledTimes(4);
    } finally {
      await worker.onModuleDestroy();
      jest.useRealTimers();
    }
  });
});
