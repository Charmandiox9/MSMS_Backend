import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicReportsService } from './academic-reports.service';
import {
  AcademicReportQuery,
  AcademicReportsController,
  AcademicReportsGuard,
} from './academic-reports.controller';

describe('Academic reports', () => {
  const prisma = {
    teacher: { findMany: jest.fn() },
    course: { findMany: jest.fn() },
    teachingAssignment: { findMany: jest.fn() },
    teachingAssistant: { findMany: jest.fn() },
    assistantship: { findMany: jest.fn() },
    academicSemester: { findMany: jest.fn() },
    project: { findMany: jest.fn(), count: jest.fn() },
    research: { findMany: jest.fn(), count: jest.fn() },
    researchOutput: { findMany: jest.fn(), count: jest.fn() },
    hourlyTeachingContract: { findMany: jest.fn() },
    user: { findFirst: jest.fn() },
  };
  let reports: AcademicReportsService;
  let guard: AcademicReportsGuard;
  let controller: AcademicReportsController;
  it('exports each course room with its corresponding weekly schedule', async () => {
    prisma.course.findMany.mockResolvedValue([
      {
        code: 'ED',
        name: 'Datos',
        assignments: [],
        schedules: [
          {
            nrc: '10001',
            day: 'Lunes',
            block: 'A',
            location: 'Sala 1',
            semester: { name: '2026-2' },
          },
          {
            nrc: '10001',
            day: 'Miércoles',
            block: 'B',
            location: 'Laboratorio 3',
            semester: { name: '2026-2' },
          },
        ],
      },
    ]);
    const result = await reports.data('courses');
    expect(result.rows[0].schedules).toBe(
      '10001: Lunes A · Sala 1 (2026-2); 10001: Miércoles B · Laboratorio 3 (2026-2)',
    );
  });
  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AcademicReportsService,
        AcademicReportsGuard,
        AcademicReportsController,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    reports = module.get(AcademicReportsService);
    guard = module.get(AcademicReportsGuard);
    controller = module.get(AcademicReportsController);
  });
  it('filters teachers by semester and search while returning export columns', async () => {
    prisma.teacher.findMany.mockResolvedValue([
      {
        name: 'Ana',
        email: 'ana@example.test',
        isActive: true,
        assignments: [
          {
            nrc: '10001',
            course: { name: 'Biología' },
            semester: { name: '2026-2' },
          },
        ],
      },
      {
        name: 'Luis',
        email: 'luis@example.test',
        isActive: false,
        assignments: [],
      },
    ]);
    const result = await controller.list({
      dataset: 'teachers',
      semesterId: 'semester',
      search: 'biología',
    });
    expect(result.rows).toHaveLength(1);
    expect(result.columns).toEqual(['name', 'email', 'status', 'courses']);
    expect(prisma.teacher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignments: { some: { semesterId: 'semester' } } },
      }),
    );
  });
  it('exports assistantship NRC separately from course NRC and includes all schedules', async () => {
    prisma.assistantship.findMany.mockResolvedValue([
      {
        nrc: '20001',
        startsOn: new Date('2026-08-01'),
        endsOn: null,
        weeklyHours: null,
        teachingAssignment: {
          semester: { name: '2026-2' },
          course: { name: 'Biología' },
          teacher: { name: 'Ana' },
          nrc: '10001',
        },
        approval: {
          assistant: { name: 'Ayudante', email: 'helper@example.test' },
        },
        schedules: [
          {
            weekday: 1,
            startsAtMinute: 490,
            endsAtMinute: 580,
            location: 'Sala 2',
          },
        ],
      },
    ]);
    const result = await controller.exportReport({ dataset: 'assistantships' });
    expect(result.rows[0]).toMatchObject({
      assistantshipNrc: '20001',
      courseNrc: '10001',
      schedules: '1 A 08:10–09:40 (Sala 2)',
    });
  });
  it('exports course schedules even when there is no teaching assignment', async () => {
    prisma.course.findMany.mockResolvedValue([
      {
        code: 'BIO101',
        name: 'Biología',
        assignments: [],
        schedules: [
          {
            nrc: '10001',
            day: 'Lunes',
            block: 'A',
            semester: { name: '2026-2' },
          },
        ],
      },
    ]);
    expect(
      (await reports.data('courses', undefined, '10001')).rows[0],
    ).toMatchObject({ schedules: '10001: Lunes A (2026-2)' });
  });

  it.each(['courses', 'assignments', 'assistants', 'semesters'] as const)(
    'supports the %s dataset',
    async (dataset) => {
      prisma.course.findMany.mockResolvedValue([]);
      prisma.teachingAssignment.findMany.mockResolvedValue([]);
      prisma.teachingAssistant.findMany.mockResolvedValue([]);
      prisma.academicSemester.findMany.mockResolvedValue([]);
      expect((await reports.data(dataset)).rows).toEqual([]);
    },
  );
  it('exports projects with financial fields filtered by reporting year', async () => {
    prisma.project.findMany.mockResolvedValue([
      {
        reportingYear: 2026,
        title: 'Proyecto marino',
        code: 'PM-26',
        academicUnit: 'Oceanografía',
        status: 'ACTIVE',
        classification: null,
        fundingSource: 'ANID',
        program: null,
        currency: 'CLP',
        totalAmount: { toString: () => '227700000' },
        vraContribution: null,
        vridtContribution: null,
        recoveryAmount: null,
        facultyContribution: null,
        depreciationAmount: null,
        profitabilityAmount: null,
        startsOn: null,
        endsOn: null,
        closedOn: null,
      },
    ]);
    const result = await reports.data('projects', undefined, undefined, 2026);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reportingYear: 2026 }),
      }),
    );
    expect(result.rows[0]).toMatchObject({
      title: 'Proyecto marino',
      totalAmount: '227700000',
      currency: 'CLP',
    });
  });
  it('pushes repository report search into the database query', async () => {
    prisma.project.findMany.mockResolvedValue([]);
    prisma.research.findMany.mockResolvedValue([]);
    prisma.researchOutput.findMany.mockResolvedValue([]);

    await reports.data('projects', undefined, '  coral  ');
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { title: { contains: 'coral', mode: 'insensitive' } },
            { fundingSource: { contains: 'coral', mode: 'insensitive' } },
          ]),
        }),
      }),
    );

    await reports.data('research', undefined, 'coral');
    expect(prisma.research.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([
                { title: { contains: 'coral', mode: 'insensitive' } },
              ]),
            }),
          ],
        },
      }),
    );

    await reports.data('researchOutputs', undefined, 'coral');
    expect(prisma.researchOutput.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { title: { contains: 'coral', mode: 'insensitive' } },
            { journal: { contains: 'coral', mode: 'insensitive' } },
          ]),
        }),
      }),
    );
  });
  it('paginates repository report rows in Prisma while preserving the total', async () => {
    prisma.project.findMany.mockResolvedValue([{ title: 'Proyecto 11' }]);
    prisma.project.count.mockResolvedValue(31);
    const result = await reports.data(
      'projects',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      2,
      10,
    );
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
    expect(prisma.project.count).toHaveBeenCalledWith({ where: {} });
    expect(result).toMatchObject({
      rows: [{ title: 'Proyecto 11' }],
      totalRows: 31,
      page: 2,
      pageSize: 10,
    });
  });
  it('applies report date ranges to research and publication dates in the database', async () => {
    prisma.research.findMany.mockResolvedValue([]);
    prisma.researchOutput.findMany.mockResolvedValue([]);
    await reports.data(
      'research',
      undefined,
      undefined,
      undefined,
      '2025-01-01',
      '2025-12-31',
    );
    expect(prisma.research.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { startsOn: { lte: new Date('2025-12-31T23:59:59.999Z') } },
            {
              OR: [
                { endsOn: { gte: new Date('2025-01-01T00:00:00.000Z') } },
                { endsOn: null },
              ],
            },
          ],
        },
      }),
    );
    await reports.data(
      'researchOutputs',
      undefined,
      undefined,
      undefined,
      '2025-01-01',
      '2025-12-31',
    );
    expect(prisma.researchOutput.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          publicationDate: {
            gte: new Date('2025-01-01T00:00:00.000Z'),
            lte: new Date('2025-12-31T23:59:59.999Z'),
          },
        },
      }),
    );
  });
  it('filters project budgets by date overlap and rejects inverted ranges', async () => {
    prisma.project.findMany.mockResolvedValue([]);
    await reports.data(
      'projects',
      undefined,
      undefined,
      undefined,
      '2025-03-01',
      '2025-09-30',
    );
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          startsOn: { lte: new Date('2025-09-30T23:59:59.999Z') },
          endsOn: { gte: new Date('2025-03-01T00:00:00.000Z') },
        },
      }),
    );
    await expect(
      reports.data(
        'projects',
        undefined,
        undefined,
        undefined,
        '2025-10-01',
        '2025-09-30',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('exports research outputs including outputs without a linked research record', async () => {
    prisma.researchOutput.findMany.mockResolvedValue([
      {
        reportingYear: 2026,
        kind: 'ARTICLE',
        title: 'Artículo',
        research: null,
        journal: null,
        publisher: null,
        quartile: null,
        indexation: null,
        publicationDate: null,
        _count: { authors: 2, projects: 0 },
      },
    ]);
    const result = await reports.data(
      'researchOutputs',
      undefined,
      undefined,
      2026,
    );
    expect(result.rows[0]).toMatchObject({
      research: null,
      authorCount: 2,
      projectCount: 0,
    });
  });
  it('calculates estimated PH amounts and filters by semester', async () => {
    prisma.hourlyTeachingContract.findMany.mockResolvedValue([
      {
        hourlyRateClp: new Prisma.Decimal(10000),
        directHours: new Prisma.Decimal(3),
        startsOn: new Date('2026-08-01T00:00:00.000Z'),
        endsOn: new Date('2026-08-30T00:00:00.000Z'),
        component: 'LECTURE',
        parallel: 'A',
        teachingAssignment: {
          semester: { name: '2026-2' },
          course: { name: 'Biología' },
          teacher: { name: 'Ana' },
          nrc: '10001',
        },
      },
    ]);
    const result = await reports.data('hourlyContracts', 'semester');
    expect(prisma.hourlyTeachingContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { semesterId: 'semester' } }),
    );
    expect(result.rows[0]).toMatchObject({
      teacher: 'Ana',
      course: 'Biología',
      monthlyAmountClp: '30000.00',
    });
  });
  const context = (name: string, authenticated = true) =>
    ({
      getType: () => 'http',
      getHandler: () => ({ name }),
      switchToHttp: () => ({
        getRequest: () => ({
          user: authenticated ? { id: 'user' } : undefined,
        }),
      }),
    }) as unknown as ExecutionContext;
  it.each([
    ['list', 'REPORTS_VIEW'],
    ['exportReport', 'REPORTS_EXPORT'],
  ])('checks the persistent permission for %s', async (name, permission) => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user' });
    expect(await guard.canActivate(context(name))).toBe(true);
    expect(
      prisma.user.findFirst.mock.calls[0][0].where.userRoles.some.role
        .permissions.some.permission.code,
    ).toBe(permission);
  });
  it('rejects unauthorized users and invalid filter inputs', async () => {
    await expect(
      guard.canActivate(context('list', false)),
    ).rejects.toMatchObject({ status: 401 });
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      guard.canActivate(context('exportReport')),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      validateSync(
        plainToInstance(AcademicReportQuery, {
          dataset: 'users',
          semesterId: 'bad',
          reportingYear: 1800,
          startsOn: 'not-a-date',
        }),
      ).map((error) => error.property),
    ).toEqual(
      expect.arrayContaining([
        'dataset',
        'semesterId',
        'reportingYear',
        'startsOn',
      ]),
    );
  });
});
