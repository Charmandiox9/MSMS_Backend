import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicReportsService } from './academic-reports.service';
import {
  AcademicChartFilters,
  AcademicChartSummary,
  reportTable,
} from './academic-reports.graphql';
import { calculateHourlyPayment } from './hourly-payment-calculator';

const budgetColumns = new Set([
  'reportingYear',
  'title',
  'code',
  'status',
  'currency',
  'startsOn',
  'fundingSource',
  'totalAmount',
  'vraContribution',
  'vridtContribution',
  'recoveryAmount',
  'facultyContribution',
  'depreciationAmount',
  'profitabilityAmount',
]);

@Injectable()
export class AcademicChartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: AcademicReportsService,
  ) {}

  async summary(filters: AcademicChartFilters): Promise<AcademicChartSummary> {
    if (filters.startsOn && filters.endsOn && filters.startsOn > filters.endsOn)
      throw new BadRequestException(
        'La fecha inicial debe ser anterior a la fecha final',
      );
    const yearDates = filters.reportingYear
      ? {
          gte: new Date(`${filters.reportingYear}-01-01T00:00:00.000Z`),
          lt: new Date(`${filters.reportingYear + 1}-01-01T00:00:00.000Z`),
        }
      : undefined;
    const [projects, research, outputs, contracts, semesters] =
      await Promise.all([
        this.reports.data(
          'projects',
          undefined,
          undefined,
          filters.reportingYear,
          filters.startsOn,
          filters.endsOn,
        ),
        this.prisma.research.groupBy({
          by: ['startsOn'],
          where: yearDates ? { startsOn: yearDates } : {},
          _count: { _all: true },
        }),
        this.prisma.researchOutput.groupBy({
          by: ['kind', 'reportingYear'],
          where: filters.reportingYear
            ? { reportingYear: filters.reportingYear }
            : {},
          _count: { _all: true },
        }),
        this.prisma.hourlyTeachingContract.findMany({
          where: {
            ...(filters.semesterId ? { semesterId: filters.semesterId } : {}),
            ...(yearDates ? { startsOn: yearDates } : {}),
          },
          select: {
            component: true,
            directHours: true,
            hourlyRateClp: true,
            startsOn: true,
            endsOn: true,
          },
        }),
        this.reports.semesterOptions(),
      ]);
    const researchYears = new Map<string, number>();
    for (const row of research) {
      const year = row.startsOn ? String(row.startsOn.getUTCFullYear()) : '';
      researchYears.set(year, (researchYears.get(year) ?? 0) + row._count._all);
    }
    const hourly = new Map<string, { amount: Prisma.Decimal; count: number }>();
    for (const contract of contracts) {
      const previous = hourly.get(contract.component) ?? {
        amount: new Prisma.Decimal(0),
        count: 0,
      };
      previous.amount = previous.amount.add(
        calculateHourlyPayment(contract).totalAmountClp,
      );
      previous.count += 1;
      hourly.set(contract.component, previous);
    }
    return {
      projects: reportTable({
        ...projects,
        columns: projects.columns.filter((column) => budgetColumns.has(column)),
      }),
      semesters,
      researchByYear: [...researchYears]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, count]) => ({ label, value: String(count) })),
      outputs: outputs.map((row) => ({
        kind: row.kind,
        reportingYear: row.reportingYear,
        count: row._count._all,
      })),
      hourlyByComponent: [...hourly]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, value]) => ({
          label,
          value: value.amount.toFixed(0),
          count: value.count,
        })),
    };
  }
}
