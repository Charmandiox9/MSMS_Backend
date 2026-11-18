import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type TitulationProcess } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isValidChileanRut, normalizeChileanRut } from './chilean-rut.util';
import type { LegacyAccessTitulationRecord } from './legacy-access-import.util';
import { StudentIdentityService } from '../students/student-identity.service';

const LEGACY_CAREER_NAME = 'Biología Marina';

type ExistingProcess = Pick<
  TitulationProcess,
  | 'id'
  | 'studentId'
  | 'studentRut'
  | 'studentName'
  | 'studentEmail'
  | 'studentPhone'
  | 'thesisTopic'
  | 'degree'
  | 'careerName'
  | 'careerId'
  | 'guideName'
  | 'coGuideName'
  | 'reviewerOneName'
  | 'reviewerTwoName'
  | 'defenseDate'
  | 'source'
>;

export interface LegacyImportWriteSummary {
  created: number;
  enriched: number;
  unchanged: number;
}

@Injectable()
export class LegacyAccessImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identities: StudentIdentityService,
  ) {}

  async importRecords(
    records: readonly LegacyAccessTitulationRecord[],
  ): Promise<LegacyImportWriteSummary> {
    if (
      records.length === 0 ||
      records.some(
        (record) => !record.studentRut || !isValidChileanRut(record.studentRut),
      )
    )
      throw new BadRequestException(
        'La importación requiere registros con RUT válidos para evitar duplicados',
      );

    const normalizedRuts = records.map((record) => {
      if (!record.studentRut)
        throw new BadRequestException(
          'La importación requiere RUT para evitar duplicados',
        );
      return normalizeChileanRut(record.studentRut);
    });
    if (new Set(normalizedRuts).size !== normalizedRuts.length)
      throw new BadRequestException('La importación contiene RUT duplicados');

    return this.prisma.$transaction(
      async (transaction) => {
        const career = await transaction.career.findFirst({
          where: { name: { equals: LEGACY_CAREER_NAME, mode: 'insensitive' } },
          select: { id: true, name: true, isActive: true },
        });
        if (!career || !career.isActive)
          throw new NotFoundException(
            'La carrera de la fuente histórica no está activa en el catálogo',
          );

        const existing = await transaction.titulationProcess.findMany({
          where: { studentRut: { in: normalizedRuts } },
          select: {
            id: true,
            studentId: true,
            studentRut: true,
            studentName: true,
            studentEmail: true,
            studentPhone: true,
            thesisTopic: true,
            degree: true,
            careerName: true,
            careerId: true,
            guideName: true,
            coGuideName: true,
            reviewerOneName: true,
            reviewerTwoName: true,
            defenseDate: true,
            source: true,
          },
        });
        const existingByRut = new Map<string, ExistingProcess>();
        for (const process of existing) {
          if (!process.studentRut) continue;
          const rut = normalizeChileanRut(process.studentRut);
          if (existingByRut.has(rut))
            throw new BadRequestException(
              'Hay expedientes duplicados para un mismo RUT; la importación se detuvo',
            );
          existingByRut.set(rut, process);
        }

        const summary: LegacyImportWriteSummary = {
          created: 0,
          enriched: 0,
          unchanged: 0,
        };

        for (let index = 0; index < records.length; index += 1) {
          const record = records[index];
          const rut = normalizedRuts[index];
          const previous = existingByRut.get(rut);
          const studentId = await this.identities.resolve(
            transaction,
            {
              name: record.studentName,
              rut,
              email: record.studentEmail,
              careerId: career.id,
            },
            previous?.studentId,
          );

          if (!previous) {
            await transaction.titulationProcess.create({
              data: {
                studentId,
                studentName: record.studentName,
                studentRut: rut,
                studentEmail: record.studentEmail,
                studentPhone: record.studentPhone,
                thesisTopic: record.thesisTopic,
                degree: null,
                careerName: career.name,
                careerId: career.id,
                guideName: record.guideName,
                coGuideName: record.coGuideName,
                reviewerOneName: record.reviewerOneName,
                reviewerTwoName: record.reviewerTwoName,
                defenseDate: record.defenseDate,
                stage: 'UNCLASSIFIED',
                source: 'LEGACY_ACCESS',
                defenseAnnexesStatus: 'UNVERIFIED',
                thesisSummaryStatus: 'UNVERIFIED',
                libraryFormStatus: 'UNVERIFIED',
                actaStatus: 'UNVERIFIED',
                evaluationsStatus: 'UNVERIFIED',
              },
            });
            summary.created += 1;
            continue;
          }

          const update = this.missingFields(previous, record, career);
          if (previous.studentId !== studentId) update.studentId = studentId;
          if (Object.keys(update).length === 0) {
            summary.unchanged += 1;
            continue;
          }

          await transaction.titulationProcess.update({
            where: { id: previous.id },
            data: update,
          });
          summary.enriched += 1;
        }

        return summary;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    );
  }

  async linkExistingStudents(): Promise<{ linked: number }> {
    return this.prisma.$transaction(
      async (transaction) => {
        const processes = await transaction.titulationProcess.findMany({
          where: { studentId: null },
          select: {
            id: true,
            studentName: true,
            studentRut: true,
            studentEmail: true,
            careerId: true,
          },
          orderBy: { id: 'asc' },
        });
        for (const process of processes) {
          const studentId = await this.identities.resolve(transaction, {
            name: process.studentName,
            rut: process.studentRut,
            email: process.studentEmail,
            careerId: process.careerId,
          });
          await transaction.titulationProcess.update({
            where: { id: process.id },
            data: { studentId },
          });
        }
        return { linked: processes.length };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    );
  }

  private missingFields(
    existing: ExistingProcess,
    incoming: LegacyAccessTitulationRecord,
    career: { id: string; name: string },
  ): Prisma.TitulationProcessUncheckedUpdateInput {
    const update: Prisma.TitulationProcessUncheckedUpdateInput = {};
    if (!existing.studentName.trim()) update.studentName = incoming.studentName;
    if (!existing.studentEmail && incoming.studentEmail)
      update.studentEmail = incoming.studentEmail;
    if (!existing.studentPhone && incoming.studentPhone)
      update.studentPhone = incoming.studentPhone;
    if (!existing.thesisTopic && incoming.thesisTopic)
      update.thesisTopic = incoming.thesisTopic;
    if (!existing.guideName && incoming.guideName)
      update.guideName = incoming.guideName;
    if (!existing.coGuideName && incoming.coGuideName)
      update.coGuideName = incoming.coGuideName;
    if (!existing.reviewerOneName && incoming.reviewerOneName)
      update.reviewerOneName = incoming.reviewerOneName;
    if (!existing.reviewerTwoName && incoming.reviewerTwoName)
      update.reviewerTwoName = incoming.reviewerTwoName;
    if (!existing.defenseDate && incoming.defenseDate)
      update.defenseDate = incoming.defenseDate;
    if (!existing.careerId) {
      update.careerId = career.id;
      update.careerName = career.name;
    }
    return update;
  }
}
