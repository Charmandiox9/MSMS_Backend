import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  AcademicImportStatus,
  AcademicImportType,
  Prisma,
} from '@prisma/client';
import { PiiCryptoService } from '../privacy/pii-crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkbookImportDto } from './academic-imports.dto';
import { AcademicImportsService } from './academic-imports.service';

const POLL_INTERVAL_MS = 5_000;
const STALE_JOB_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

type ImportResult = {
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
  duplicates: { row: number; message: string }[];
  totalAmountClp?: string;
};

@Injectable()
export class AcademicImportQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AcademicImportQueueService.name);
  private polling = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PiiCryptoService,
    private readonly imports: AcademicImportsService,
  ) {}

  async onModuleInit() {
    await this.recoverInterruptedJobs();
    this.timer = setInterval(() => void this.processNext(), POLL_INTERVAL_MS);
    void this.processNext();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueue(
    type: AcademicImportType,
    input: WorkbookImportDto,
    requestedById: string,
  ) {
    const id = crypto.randomUUID();
    const payload = this.crypto.encrypt(
      JSON.stringify(input),
      this.payloadContext(id),
    );
    await this.prisma.academicImportJob.create({
      data: { id, type, payload, requestedById },
      select: { id: true, status: true, createdAt: true },
    });
    void this.processNext();
    return { id, status: AcademicImportStatus.QUEUED };
  }

  async getStatus(id: string) {
    const job = await this.prisma.academicImportJob.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        result: true,
        error: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    if (!job) throw new NotFoundException('La importación no existe');
    return job;
  }

  private payloadContext(id: string) {
    return `AcademicImportJob.${id}.payload`;
  }

  private async recoverInterruptedJobs() {
    const staleBefore = new Date(Date.now() - STALE_JOB_MS);
    await this.prisma.academicImportJob.updateMany({
      where: {
        status: AcademicImportStatus.PROCESSING,
        startedAt: { lt: staleBefore },
        attempts: { lt: MAX_ATTEMPTS },
      },
      data: { status: AcademicImportStatus.QUEUED, startedAt: null },
    });
    await this.prisma.academicImportJob.updateMany({
      where: {
        status: AcademicImportStatus.PROCESSING,
        startedAt: { lt: staleBefore },
        attempts: { gte: MAX_ATTEMPTS },
      },
      data: {
        status: AcademicImportStatus.FAILED,
        error:
          'El trabajo se interrumpió repetidamente; revisa el repositorio antes de reintentarlo.',
        payload: null,
        finishedAt: new Date(),
      },
    });
  }

  private async processNext() {
    if (this.polling) return;
    this.polling = true;
    try {
      const job = await this.claimNext();
      if (!job) return;
      await this.process(job);
    } catch {
      this.logger.error('No se pudo procesar el siguiente trabajo de importación');
    } finally {
      this.polling = false;
    }
  }

  private claimNext() {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "AcademicImportJob"
        WHERE "status" = 'QUEUED'::"AcademicImportStatus"
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const candidate = rows[0];
      if (!candidate) return null;
      return tx.academicImportJob.update({
        where: { id: candidate.id },
        data: {
          status: AcademicImportStatus.PROCESSING,
          startedAt: new Date(),
          finishedAt: null,
          error: null,
          attempts: { increment: 1 },
        },
      });
    });
  }

  private async process(job: {
    id: string;
    type: AcademicImportType;
    payload: string | null;
  }) {
    try {
      if (!job.payload) throw new Error('El trabajo no contiene el archivo');
      const input = JSON.parse(
        this.crypto.decrypt(job.payload, this.payloadContext(job.id)),
      ) as WorkbookImportDto;
      const result = await this.run(job.type, input);
      await this.prisma.academicImportJob.update({
        where: { id: job.id },
        data: {
          status: AcademicImportStatus.COMPLETED,
          result: result as Prisma.InputJsonValue,
          payload: null,
          finishedAt: new Date(),
          error: null,
        },
      });
      this.logger.log(`Trabajo académico completado: ${job.id}`);
    } catch (cause) {
      await this.prisma.academicImportJob.update({
        where: { id: job.id },
        data: {
          status: AcademicImportStatus.FAILED,
          error: this.safeError(cause),
          payload: null,
          finishedAt: new Date(),
        },
      });
      this.logger.warn(`Trabajo académico fallido: ${job.id}`);
    }
  }

  private run(type: AcademicImportType, input: WorkbookImportDto) {
    switch (type) {
      case AcademicImportType.PROJECTS:
        return this.imports.importProjects(input.fileBase64);
      case AcademicImportType.RESEARCH:
        return this.imports.importResearch(input.fileBase64);
      case AcademicImportType.HOURLY:
        return this.imports.importHourly(input.fileBase64, input.teacherEmails);
    }
  }

  private safeError(cause: unknown) {
    if (!(cause instanceof HttpException))
      return 'Ocurrió un error al procesar el archivo. Revisa el archivo e inténtalo nuevamente.';
    const response = cause.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response && 'message' in response) {
      const { message } = response;
      if (typeof message === 'string') return message;
      if (
        Array.isArray(message) &&
        message.every((item) => typeof item === 'string')
      )
        return message.join('; ');
    }
    return cause.message;
  }
}
