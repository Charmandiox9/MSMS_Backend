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
import { CareersService } from '../careers/careers.service';
import { CreateCareerFromCsvDto, ImportCurriculumDto } from '../careers/careers.dto';
import { WorkbookImportDto } from './academic-imports.dto';
import { AcademicImportsService } from './academic-imports.service';

const POLL_INTERVAL_MS = 5_000;
const STALE_JOB_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

type CurriculumJobPayload =
  | { operation: 'CREATE_CAREER'; input: CreateCareerFromCsvDto }
  | {
      operation: 'ADD_VERSION';
      careerId: string;
      input: ImportCurriculumDto;
    };

type AcademicImportPayload = WorkbookImportDto | CurriculumJobPayload;

@Injectable()
export class AcademicImportQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AcademicImportQueueService.name);
  private polling = false;
  private timer: NodeJS.Timeout | undefined;
  private runningPoll: Promise<void> | undefined;
  private stopped = false;
  private lastRecoveryAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PiiCryptoService,
    private readonly imports: AcademicImportsService,
    private readonly careers: CareersService,
  ) {}

  async onModuleInit() {
    await this.recoverInterruptedJobs();
    this.lastRecoveryAt = Date.now();
    this.timer = setInterval(() => void this.processNext(), POLL_INTERVAL_MS);
    void this.processNext();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.runningPoll;
  }

  async enqueue(
    type: AcademicImportType,
    input: AcademicImportPayload,
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
        updatedAt: { lt: staleBefore },
        attempts: { lt: MAX_ATTEMPTS },
      },
      data: { status: AcademicImportStatus.QUEUED, startedAt: null },
    });
    await this.prisma.academicImportJob.updateMany({
      where: {
        status: AcademicImportStatus.PROCESSING,
        updatedAt: { lt: staleBefore },
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

  private processNext(): Promise<void> {
    if (this.stopped || this.polling)
      return this.runningPoll ?? Promise.resolve();
    this.polling = true;
    this.runningPoll = this.poll();
    return this.runningPoll;
  }

  private async poll() {
    try {
      if (Date.now() - this.lastRecoveryAt >= 60_000) {
        await this.recoverInterruptedJobs();
        this.lastRecoveryAt = Date.now();
      }
      const job = await this.claimNext();
      if (!job) return;
      await this.process(job);
    } catch {
      this.logger.error(
        'No se pudo procesar el siguiente trabajo de importación',
      );
    } finally {
      this.runningPoll = undefined;
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
    const heartbeat = setInterval(() => {
      void this.prisma.academicImportJob
        .updateMany({
          where: { id: job.id, status: AcademicImportStatus.PROCESSING },
          data: { updatedAt: new Date() },
        })
        .catch(() =>
          this.logger.warn(
            'No se pudo actualizar la actividad de una importación',
          ),
        );
    }, 30_000);
    try {
      if (!job.payload) throw new Error('El trabajo no contiene el archivo');
      const input = JSON.parse(
        this.crypto.decrypt(job.payload, this.payloadContext(job.id)),
      ) as AcademicImportPayload;
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
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async run(type: AcademicImportType, input: AcademicImportPayload) {
    switch (type) {
      case AcademicImportType.PROJECTS:
        if (!('fileBase64' in input)) throw new Error('El trabajo no contiene el archivo');
        return this.imports.importProjects(input.fileBase64);
      case AcademicImportType.RESEARCH:
        if (!('fileBase64' in input)) throw new Error('El trabajo no contiene el archivo');
        return this.imports.importResearch(input.fileBase64);
      case AcademicImportType.HOURLY:
        if (!('fileBase64' in input)) throw new Error('El trabajo no contiene el archivo');
        return this.imports.importHourly(input.fileBase64, input.teacherEmails);
      case AcademicImportType.CURRICULUM:
        if (!('operation' in input)) throw new Error('El trabajo no contiene la malla curricular');
        if (input.operation === 'CREATE_CAREER') {
          const career = await this.careers.create({
            code: input.input.code,
            name: input.input.name,
            cohortYear: input.input.cohortYear,
            curriculumCourses: input.input.courses,
          });
          return {
            careerId: career.id,
            careerName: career.name,
            cohortYear: input.input.cohortYear,
            imported: input.input.courses.length,
          };
        }
        await this.careers.importVersion(input.careerId, input.input);
        return {
          careerId: input.careerId,
          cohortYear: input.input.cohortYear,
          imported: input.input.courses.length,
        };
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
