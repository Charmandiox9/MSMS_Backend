import { Test, TestingModule } from '@nestjs/testing';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';
import { ExecutionContext } from '@nestjs/common';
import { graphql } from 'graphql';
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicChartsService } from './academic-charts.service';
import { AcademicReportsService } from './academic-reports.service';
import { AcademicReportsResolver } from './academic-reports.resolver';
import { AcademicReportsGuard } from './academic-reports.controller';
import {
  AcademicReportQuery,
  AcademicChartFilters,
} from './academic-reports.graphql';

describe('indicadores y reportes GraphQL', () => {
  const prisma = {
    research: { groupBy: jest.fn() },
    researchOutput: { groupBy: jest.fn() },
    hourlyTeachingContract: { findMany: jest.fn() },
    user: { findFirst: jest.fn() },
  };
  const reports = { data: jest.fn(), semesterOptions: jest.fn() };
  let module: TestingModule;
  let charts: AcademicChartsService;
  let resolver: AcademicReportsResolver;
  let guard: AcademicReportsGuard;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [GraphQLSchemaBuilderModule],
      providers: [
        AcademicChartsService,
        AcademicReportsResolver,
        AcademicReportsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: AcademicReportsService, useValue: reports },
      ],
    }).compile();
    charts = module.get(AcademicChartsService);
    resolver = module.get(AcademicReportsResolver);
    guard = module.get(AcademicReportsGuard);
  });
  afterAll(async () => module.close());
  beforeEach(() => {
    jest.clearAllMocks();
    reports.data.mockResolvedValue({
      columns: ['title'],
      rows: [{ title: 'Proyecto' }],
    });
    reports.semesterOptions.mockResolvedValue([]);
    prisma.research.groupBy.mockResolvedValue([]);
    prisma.researchOutput.groupBy.mockResolvedValue([]);
    prisma.hourlyTeachingContract.findMany.mockResolvedValue([]);
  });

  it('agrega los indicadores sin informes de personas y conserva el cálculo PH exacto', async () => {
    prisma.research.groupBy.mockResolvedValue([
      { startsOn: new Date('2026-01-01Z'), _count: { _all: 400 } },
      { startsOn: new Date('2026-06-01Z'), _count: { _all: 600 } },
      { startsOn: null, _count: { _all: 3 } },
    ]);
    prisma.researchOutput.groupBy.mockResolvedValue([
      { reportingYear: 2026, kind: 'ARTICLE', _count: { _all: 2000 } },
    ]);
    const contract = {
      component: 'LECTURE',
      hourlyRateClp: new Prisma.Decimal('1000'),
      directHours: new Prisma.Decimal(2),
      startsOn: new Date('2026-02-01Z'),
      endsOn: new Date('2026-02-28Z'),
    };
    prisma.hourlyTeachingContract.findMany.mockResolvedValue([
      contract,
      contract,
    ]);
    const result = await charts.summary({
      semesterId: 'semester',
    });
    expect(reports.data).toHaveBeenCalledTimes(1);
    expect(reports.data).toHaveBeenCalledWith(
      'projects',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result.researchByYear).toEqual([
      { label: '', value: '3' },
      { label: '2026', value: '1000' },
    ]);
    expect(result.outputs).toEqual([
      { reportingYear: 2026, kind: 'ARTICLE', count: 2000 },
    ]);
    expect(result.hourlyByComponent).toEqual([
      { label: 'LECTURE', value: '4000', count: 2 },
    ]);
    expect(prisma.hourlyTeachingContract.findMany).toHaveBeenCalledWith({
      where: {
        semesterId: 'semester',
      },
      select: {
        component: true,
        directHours: true,
        hourlyRateClp: true,
        startsOn: true,
        endsOn: true,
      },
    });
    expect(prisma.research.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.researchOutput.groupBy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('teacher');
  });

  it('filtra año en investigación, resultados, presupuestos y contratos sin confundir sus fechas', async () => {
    await charts.summary({ reportingYear: 2026 });
    const dates = {
      gte: new Date('2026-01-01T00:00:00.000Z'),
      lt: new Date('2027-01-01T00:00:00.000Z'),
    };
    expect(prisma.research.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { startsOn: dates } }),
    );
    expect(prisma.researchOutput.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reportingYear: 2026 } }),
    );
    expect(prisma.hourlyTeachingContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { startsOn: dates } }),
    );
    expect(reports.data).toHaveBeenCalledWith(
      'projects',
      undefined,
      undefined,
      2026,
      undefined,
      undefined,
    );
  });

  it('rechaza un rango invertido antes de consultar y conserva estados vacíos', async () => {
    await expect(
      charts.summary({ startsOn: '2026-06-01', endsOn: '2026-01-01' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(reports.data).not.toHaveBeenCalled();
    expect((await charts.summary({})).hourlyByComponent).toEqual([]);
  });

  it('genera el esquema y serializa celdas de texto, números y nulos sin perder precisión', async () => {
    const schema = await module
      .get(GraphQLSchemaFactory)
      .create([AcademicReportsResolver]);
    reports.data.mockResolvedValue({
      columns: ['amount', 'count', 'missing'],
      rows: [{ amount: '9999999999999999.99', count: 4, missing: null }],
      totalRows: 30,
      page: 2,
      pageSize: 20,
    });
    const result = await graphql({
      schema,
      source:
        'query($filters: AcademicReportQuery!) { academicReport(filters: $filters) { columns rows { values } totalRows page pageSize } }',
      variableValues: {
        filters: { dataset: 'projects', page: 2, pageSize: 20 },
      },
      rootValue: {
        academicReport: () =>
          resolver.academicReport({
            dataset: 'projects',
            page: 2,
            pageSize: 20,
          }),
      },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.academicReport).toMatchObject({
      rows: [{ values: ['9999999999999999.99', 4, null] }],
      totalRows: 30,
      page: 2,
    });
  });

  it('valida datasets, paginación, año, semestre y fechas del nuevo transporte', async () => {
    const report = Object.assign(new AcademicReportQuery(), {
      dataset: 'users',
      page: 0,
      pageSize: 500,
    });
    expect((await validate(report)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['dataset', 'page', 'pageSize']),
    );
    const filters = Object.assign(new AcademicChartFilters(), {
      reportingYear: 1800,
      semesterId: 'bad',
      startsOn: 'not-a-date',
    });
    expect((await validate(filters)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['reportingYear', 'semesterId', 'startsOn']),
    );
  });

  it('exige REPORTS_VIEW en GraphQL y conserva REPORTS_EXPORT en REST', async () => {
    const context = (handler: (...args: never[]) => unknown) =>
      ({
        getType: () => 'graphql',
        getClass: () => AcademicReportsResolver,
        getHandler: () => handler,
        getArgs: () => [null, {}, { req: { user: { id: 'user' } } }, null],
      }) as unknown as ExecutionContext;
    prisma.user.findFirst.mockResolvedValue({ id: 'user' });
    await expect(
      guard.canActivate(context(resolver.academicCharts)),
    ).resolves.toBe(true);
    expect(prisma.user.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userRoles: {
            some: {
              role: {
                permissions: { some: { permission: { code: 'REPORTS_VIEW' } } },
              },
            },
          },
        }),
      }),
    );
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      guard.canActivate(context(resolver.academicReport)),
    ).rejects.toMatchObject({ status: 403 });
  });
});
