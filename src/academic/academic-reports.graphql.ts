import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GraphQLError, GraphQLScalarType } from 'graphql';
import type { AcademicDataset, ReportRow } from './academic-reports.service';

@InputType()
export class AcademicReportQuery {
  @Field(() => String, { defaultValue: 'assistantships' })
  @IsIn([
    'teachers',
    'courses',
    'assignments',
    'assistants',
    'assistantships',
    'semesters',
    'projects',
    'research',
    'researchOutputs',
    'hourlyContracts',
  ])
  dataset: AcademicDataset = 'assistantships';
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  semesterId?: string;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  reportingYear?: number;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startsOn?: string;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endsOn?: string;
}

export const AcademicReportValue = new GraphQLScalarType({
  name: 'AcademicReportValue',
  description:
    'A report cell containing text or a finite number. Missing values are null.',
  serialize(value: unknown) {
    if (
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return value;
    throw new GraphQLError('Invalid report cell');
  },
});

@ObjectType()
export class AcademicReportTableRow {
  @Field(() => [AcademicReportValue], { nullable: 'items' }) values!: (
    string | number | null
  )[];
}

@ObjectType()
export class AcademicReportTable {
  @Field(() => [String]) columns!: string[];
  @Field(() => [AcademicReportTableRow]) rows!: AcademicReportTableRow[];
  @Field(() => Int) totalRows!: number;
  @Field(() => Int, { nullable: true }) page?: number;
  @Field(() => Int, { nullable: true }) pageSize?: number;
}

export function reportTable(report: {
  columns: string[];
  rows: ReportRow[];
  totalRows?: number;
  page?: number;
  pageSize?: number;
}): AcademicReportTable {
  return {
    ...report,
    totalRows: report.totalRows ?? report.rows.length,
    rows: report.rows.map((row) => ({
      values: report.columns.map((column) => row[column] ?? null),
    })),
  };
}

@InputType()
export class AcademicChartFilters {
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2200)
  reportingYear?: number;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  semesterId?: string;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startsOn?: string;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endsOn?: string;
}

@ObjectType()
export class AcademicChartPoint {
  @Field(() => String) label!: string;
  // Decimal money is transferred exactly as text; conversion to chart coordinates is a UI concern.
  @Field(() => String) value!: string;
}

@ObjectType()
export class AcademicOutputChartPoint {
  @Field(() => Int) reportingYear!: number;
  @Field(() => String) kind!: string;
  @Field(() => Int) count!: number;
}

@ObjectType()
export class AcademicHourlyChartPoint extends AcademicChartPoint {
  @Field(() => Int) count!: number;
}

@ObjectType()
export class AcademicChartSemester {
  @Field(() => ID) id!: string;
  @Field(() => String) name!: string;
}

@ObjectType()
export class AcademicChartSummary {
  @Field(() => AcademicReportTable) projects!: AcademicReportTable;
  @Field(() => [AcademicChartPoint]) researchByYear!: AcademicChartPoint[];
  @Field(() => [AcademicOutputChartPoint]) outputs!: AcademicOutputChartPoint[];
  @Field(() => [AcademicHourlyChartPoint])
  hourlyByComponent!: AcademicHourlyChartPoint[];
  @Field(() => [AcademicChartSemester]) semesters!: AcademicChartSemester[];
}
