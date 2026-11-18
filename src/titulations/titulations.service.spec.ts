import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { testPiiCrypto } from '../privacy/pii-test-config';
import { PiiStorageCodec } from '../privacy/pii-storage-codec';
import { TitulationsService } from './titulations.service';
import { StudentIdentityService } from '../students/student-identity.service';
import type {
  CreateTitulationDto,
  ListTitulationsDto,
} from './titulations.dto';

const record = {
  id: 'titulation-1',
  studentId: 'student-1',
  student: {
    id: 'student-1',
    name: 'Nombre Ficticio',
    email: null,
    rut: '11111111-1',
  },
  studentName: 'María Pérez',
  studentRut: '12345678-5',
  studentEmail: 'maria@example.cl',
  studentPhone: null,
  thesisTopic: 'Evaluación de ecosistemas marinos',
  degree: 'Bióloga Marina',
  careerName: 'Biología Marina',
  careerId: '11111111-1111-4111-8111-111111111111',
  source: 'MANUAL',
  guideName: 'Profesora Guía',
  coGuideName: null,
  reviewerOneName: null,
  reviewerTwoName: null,
  defenseDate: null,
  stage: 'INTAKE',
  defenseAnnexesStatus: 'PENDING',
  thesisSummaryStatus: 'PENDING',
  libraryFormStatus: 'PENDING',
  actaStatus: 'PENDING',
  evaluationsStatus: 'PENDING',
  createdById: 'user-1',
  updatedById: 'user-1',
  studentRutHash: 'rut-blind-index',
  studentEmailHash: 'email-blind-index',
  piiVersion: 1,
  createdAt: new Date('2026-11-17T00:00:00.000Z'),
  updatedAt: new Date('2026-11-17T00:00:00.000Z'),
};

function createService() {
  const prisma = {
    findPiiIds: jest.fn().mockResolvedValue(['titulation-1']),
    $queryRaw: jest.fn().mockResolvedValue([{ year: 2026, semester: 2 }]),
    $transaction: jest.fn(
      async (
        operations:
          Promise<unknown>[] | ((client: unknown) => Promise<unknown>),
      ) =>
        typeof operations === 'function'
          ? operations(prisma)
          : Promise.all(operations),
    ),
    titulationProcess: {
      groupBy: jest.fn().mockResolvedValue([{ careerName: record.careerName }]),
      findMany: jest.fn((args: Record<string, unknown>) => {
        void args;
        return Promise.resolve([record]);
      }),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue(record),
      create: jest.fn((args: Record<string, unknown>) => {
        void args;
        return Promise.resolve(record);
      }),
      update: jest.fn().mockResolvedValue(record),
    },
    career: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Biología Marina',
        },
      ]),
      findUnique: jest.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Biología Marina',
        isActive: true,
      }),
    },
  };
  return {
    service: new TitulationsService(
      prisma as unknown as PrismaService,
      {
        resolve: jest.fn().mockResolvedValue('student-1'),
      } as unknown as StudentIdentityService,
    ),
    prisma,
  };
}

const createInput: CreateTitulationDto = {
  studentName: ' María Pérez ',
  studentRut: '12.345.678-5',
  studentEmail: ' MARIA@example.cl ',
  thesisTopic: ' Evaluación de ecosistemas marinos ',
  degree: ' Bióloga Marina ',
  careerId: '11111111-1111-4111-8111-111111111111',
  guideName: ' Profesora Guía ',
};

describe('TitulationsService', () => {
  it('filters by stage and protected-field search, then paginates', async () => {
    const { service, prisma } = createService();
    const query: ListTitulationsDto = {
      page: 1,
      pageSize: 20,
      search: 'maria',
      stage: 'INTAKE',
    };

    const result = await service.list(query);
    expect(result).toMatchObject({
      items: [
        {
          id: record.id,
          reference: 'TIT-2026-TITULATI',
          studentName: record.studentName,
          thesisTopic: record.thesisTopic,
          careerName: record.careerName,
          stage: record.stage,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    expect(prisma.findPiiIds).toHaveBeenCalledWith(
      'TitulationProcess',
      'maria',
    );
    expect(prisma.titulationProcess.findMany).toHaveBeenCalled();
    expect(prisma.titulationProcess.findMany.mock.calls[0]?.[0]).toMatchObject({
      select: {
        studentName: true,
        thesisTopic: true,
      },
      where: {
        stage: 'INTAKE',
        OR: [{ id: { in: ['titulation-1'] } }],
      },
    });
    expect(result.items[0]).not.toHaveProperty('studentRut');
    expect(result.items[0]).not.toHaveProperty('studentEmail');
    expect(result.items[0]).not.toHaveProperty('studentPhone');
  });

  it('matches stored career names without case or accents', async () => {
    const { service, prisma } = createService();
    await service.list({ page: 1, pageSize: 10, search: 'BIOLOGIA' });

    expect(prisma.titulationProcess.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        OR: [
          { id: { in: ['titulation-1'] } },
          { careerName: { in: ['Biología Marina'] } },
        ],
      },
    });
  });

  it('filters by a calendar semester using UTC date boundaries', async () => {
    const { service, prisma } = createService();

    await service.list({
      page: 1,
      pageSize: 10,
      period: '2026-S1',
      careerId: '11111111-1111-4111-8111-111111111111',
    });

    expect(prisma.titulationProcess.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        careerId: '11111111-1111-4111-8111-111111111111',
        defenseDate: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lt: new Date('2026-07-01T00:00:00.000Z'),
        },
      },
    });
  });

  it('filters separately for records without a defense date', async () => {
    const { service, prisma } = createService();

    await service.list({ page: 1, pageSize: 10, period: 'UNRECORDED' });

    expect(prisma.titulationProcess.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { defenseDate: null },
    });
  });

  it('returns distinct recorded periods, represented careers, and missing-date availability', async () => {
    const { service, prisma } = createService();

    await expect(service.filterOptions()).resolves.toEqual({
      periods: ['2026-S2'],
      careers: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Biología Marina' },
      ],
      hasUndated: true,
    });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.career.findMany).toHaveBeenCalledWith({
      where: { titulationProcesses: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    expect(prisma.titulationProcess.count).toHaveBeenCalledWith({
      where: { defenseDate: null },
    });
  });

  it('normalizes RUT and email before creating an attributed process', async () => {
    const { service, prisma } = createService();

    await service.create(createInput, 'user-1');

    expect(prisma.titulationProcess.create).toHaveBeenCalled();
    expect(prisma.titulationProcess.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        studentName: 'María Pérez',
        studentRut: '12345678-5',
        studentEmail: 'maria@example.cl',
        careerId: '11111111-1111-4111-8111-111111111111',
        careerName: 'Biología Marina',
        stage: 'INTAKE',
        createdById: 'user-1',
        updatedById: 'user-1',
      },
    });
  });

  it('creates a process with only the required identity and catalog fields', async () => {
    const { service, prisma } = createService();

    await service.create(
      {
        studentName: ' Nombre Apellido ',
        careerId: '11111111-1111-4111-8111-111111111111',
      },
      'user-1',
    );

    expect(prisma.titulationProcess.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        studentName: 'Nombre Apellido',
        studentRut: null,
        careerId: '11111111-1111-4111-8111-111111111111',
        careerName: 'Biología Marina',
      },
    });
  });

  it('rejects invalid RUT values', async () => {
    const { service, prisma } = createService();

    await expect(
      service.create({ ...createInput, studentRut: '12.345.678-0' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.titulationProcess.create).not.toHaveBeenCalled();
  });

  it('records the actor when updating a process', async () => {
    const { service, prisma } = createService();

    await service.update('titulation-1', { stage: 'REVIEW' }, 'user-2');

    expect(prisma.titulationProcess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'titulation-1' },
        data: {
          stage: 'REVIEW',
          updatedById: 'user-2',
          studentId: 'student-1',
        },
      }),
    );
  });

  it('allows optional data to be cleared without changing process provenance', async () => {
    const { service, prisma } = createService();

    await service.update(
      'titulation-1',
      { studentRut: null, studentEmail: null, thesisTopic: null },
      'user-2',
    );

    expect(prisma.titulationProcess.update.mock.calls[0]?.[0]).toMatchObject({
      data: {
        studentRut: null,
        studentEmail: null,
        thesisTopic: null,
        updatedById: 'user-2',
      },
    });
  });

  it('returns a not found response when the process does not exist', async () => {
    const { service, prisma } = createService();
    prisma.titulationProcess.findUnique.mockResolvedValueOnce(null);

    await expect(service.get('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not expose encrypted-field indexes or actor IDs in API detail', async () => {
    const { service } = createService();

    const result = await service.get('titulation-1');

    expect(result).not.toHaveProperty('studentRutHash');
    expect(result).not.toHaveProperty('studentEmailHash');
    expect(result).not.toHaveProperty('piiVersion');
    expect(result).not.toHaveProperty('createdById');
    expect(result).not.toHaveProperty('updatedById');
  });

  it('rejects an empty update', async () => {
    const { service, prisma } = createService();

    await expect(
      service.update('titulation-1', {}, 'user-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.titulationProcess.findUnique).not.toHaveBeenCalled();
  });
});

describe('TitulationProcess PII storage', () => {
  it('encrypts identifiers and free text and supports readback', () => {
    const crypto = testPiiCrypto();
    const codec = new PiiStorageCodec(crypto);
    const input = {
      id: 'titulation-1',
      studentName: 'María Pérez',
      studentRut: '12.345.678-5',
      studentEmail: 'maria@example.cl',
      studentPhone: '+56 9 1234 5678',
      thesisTopic: 'Tema de investigación',
      degree: 'Bióloga Marina',
      guideName: 'Profesora Guía',
      coGuideName: null,
      reviewerOneName: null,
      reviewerTwoName: null,
    };

    const stored = codec.write('TitulationProcess', input) as Record<
      string,
      unknown
    >;
    expect(stored.studentName).not.toBe(input.studentName);
    expect(stored.studentRut).not.toBe(input.studentRut);
    expect(stored.thesisTopic).not.toBe(input.thesisTopic);
    expect(stored.piiVersion).toBe(1);
    expect(stored.studentRutHash).toBeTruthy();
    expect(stored.studentEmailHash).toBeTruthy();
    expect(codec.read('TitulationProcess', stored)).toMatchObject(input);
  });
});
