import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LegacyAccessImportService } from './legacy-access-import.service';
import type { LegacyAccessTitulationRecord } from './legacy-access-import.util';
import { StudentIdentityService } from '../students/student-identity.service';

const career = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Biología Marina',
  isActive: true,
};

const incomingRecord: LegacyAccessTitulationRecord = {
  studentName: 'Nombre Apellido',
  studentRut: '11111111-1',
  studentEmail: 'nombre@dominio.cl',
  studentPhone: '+56 9 0000 0000',
  thesisTopic: 'Tema de investigación',
  guideName: 'Nombre Académico',
  coGuideName: null,
  reviewerOneName: 'Nombre Revisor',
  reviewerTwoName: null,
  defenseDate: new Date('2025-10-15T00:00:00.000Z'),
};

function createService(
  existingRecords: Record<string, unknown>[] = [],
  activeCareer = career,
) {
  const transaction = {
    career: {
      findFirst: jest.fn().mockResolvedValue(activeCareer),
    },
    titulationProcess: {
      findMany: jest.fn().mockResolvedValue(existingRecords),
      create: jest.fn().mockResolvedValue({ id: 'new-process' }),
      update: jest.fn().mockResolvedValue({ id: 'existing-process' }),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  };

  return {
    service: new LegacyAccessImportService(
      prisma as unknown as PrismaService,
      {
        resolve: jest.fn().mockResolvedValue('student-1'),
      } as unknown as StudentIdentityService,
    ),
    prisma,
    transaction,
  };
}

describe('LegacyAccessImportService', () => {
  it('creates unclassified legacy records with unverified document statuses', async () => {
    const { service, transaction, prisma } = createService();

    await expect(service.importRecords([incomingRecord])).resolves.toEqual({
      created: 1,
      enriched: 0,
      unchanged: 0,
    });

    expect(transaction.titulationProcess.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentName: 'Nombre Apellido',
        studentRut: '11111111-1',
        degree: null,
        careerId: career.id,
        careerName: career.name,
        stage: 'UNCLASSIFIED',
        source: 'LEGACY_ACCESS',
        defenseAnnexesStatus: 'UNVERIFIED',
        thesisSummaryStatus: 'UNVERIFIED',
        libraryFormStatus: 'UNVERIFIED',
        actaStatus: 'UNVERIFIED',
        evaluationsStatus: 'UNVERIFIED',
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('matches by a keyed RUT index and fills only missing fields on repeat imports', async () => {
    const previous = {
      id: 'existing-process',
      studentId: 'student-1',
      studentRut: '11111111-1',
      studentName: 'Nombre ya registrado',
      studentEmail: null,
      studentPhone: '+56 9 1111 1111',
      thesisTopic: null,
      degree: 'Título confirmado',
      careerName: career.name,
      careerId: career.id,
      guideName: null,
      coGuideName: null,
      reviewerOneName: 'Revisor confirmado',
      reviewerTwoName: null,
      defenseDate: null,
      source: 'MANUAL',
    };
    const enriched = {
      ...previous,
      studentEmail: incomingRecord.studentEmail,
      thesisTopic: incomingRecord.thesisTopic,
      guideName: incomingRecord.guideName,
      reviewerTwoName: incomingRecord.reviewerTwoName,
      defenseDate: incomingRecord.defenseDate,
    };
    const { service, transaction } = createService();
    transaction.titulationProcess.findMany
      .mockResolvedValueOnce([previous])
      .mockResolvedValueOnce([enriched]);

    await expect(service.importRecords([incomingRecord])).resolves.toEqual({
      created: 0,
      enriched: 1,
      unchanged: 0,
    });
    expect(transaction.titulationProcess.update).toHaveBeenCalledWith({
      where: { id: previous.id },
      data: {
        studentEmail: incomingRecord.studentEmail,
        thesisTopic: incomingRecord.thesisTopic,
        guideName: incomingRecord.guideName,
        defenseDate: incomingRecord.defenseDate,
      },
    });
    expect(transaction.titulationProcess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentRut: { in: ['11111111-1'] } },
      }),
    );
    expect(await service.importRecords([incomingRecord])).toEqual({
      created: 0,
      enriched: 0,
      unchanged: 1,
    });
    expect(transaction.titulationProcess.create).not.toHaveBeenCalled();
  });

  it('rejects invalid RUT records before opening a transaction', async () => {
    const { service, prisma } = createService();

    await expect(
      service.importRecords([{ ...incomingRecord, studentRut: '11111111-0' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stops when the source career is missing or inactive', async () => {
    const { service, transaction } = createService([], {
      ...career,
      isActive: false,
    });

    await expect(
      service.importRecords([incomingRecord]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.titulationProcess.create).not.toHaveBeenCalled();
  });
});
