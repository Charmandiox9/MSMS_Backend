import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { AcademicReportsGuard } from './academic-reports.controller';
import { AcademicReportsService } from './academic-reports.service';
import { AcademicChartsService } from './academic-charts.service';
import {
  AcademicChartFilters,
  AcademicChartSummary,
  AcademicChartSemester,
  AcademicReportQuery,
  AcademicReportTable,
  reportTable,
} from './academic-reports.graphql';

@Resolver()
@UseGuards(AcademicReportsGuard)
export class AcademicReportsResolver {
  constructor(
    private readonly reports: AcademicReportsService,
    private readonly charts: AcademicChartsService,
  ) {}

  @Query(() => [AcademicChartSemester])
  academicReportSemesters() {
    return this.reports.semesterOptions();
  }

  @Query(() => AcademicReportTable)
  async academicReport(
    @Args('filters', { type: () => AcademicReportQuery })
    filters: AcademicReportQuery,
  ) {
    return reportTable(
      await this.reports.data(
        filters.dataset,
        filters.semesterId,
        filters.search,
        filters.reportingYear,
        filters.startsOn,
        filters.endsOn,
        filters.page,
        filters.pageSize,
      ),
    );
  }

  @Query(() => AcademicChartSummary)
  academicCharts(
    @Args('filters', { nullable: true, type: () => AcademicChartFilters })
    filters?: AcademicChartFilters,
  ) {
    return this.charts.summary(filters ?? new AcademicChartFilters());
  }
}
