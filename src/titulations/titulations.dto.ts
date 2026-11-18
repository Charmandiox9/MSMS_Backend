import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  TitulationDocumentStatus,
  TitulationStage,
  TitulationOutcome,
} from '@prisma/client';
import { IsChileanRut } from './chilean-rut.validator';
import { normalizeChileanRut } from './chilean-rut.util';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimOptional = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

const trimRut = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? normalizeChileanRut(value.trim()) || null : value;

export class ListTitulationsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(TitulationStage)
  stage?: TitulationStage;

  @IsOptional()
  @IsUUID()
  careerId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^(?:UNRECORDED|[1-9][0-9]{3}-S[12])$/)
  @MaxLength(12)
  period?: string;

  @IsOptional()
  @IsIn(['ALL', 'REVIEW', 'ACTIVE', 'GRADUATED'])
  view?: 'ALL' | 'REVIEW' | 'ACTIVE' | 'GRADUATED';

  @IsOptional()
  @IsEnum(TitulationOutcome)
  outcome?: TitulationOutcome;
}

export class CreateTitulationDto {
  @IsOptional()
  @IsUUID()
  studentId?: string | null;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  studentName!: string;

  @Transform(trimRut)
  @IsOptional()
  @IsString()
  @MaxLength(12)
  @IsChileanRut()
  studentRut?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsEmail()
  @MaxLength(254)
  studentEmail?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @Matches(/^\+?[0-9().\s-]{8,24}$/)
  studentPhone?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(2000)
  thesisTopic?: string | null;

  @IsUUID()
  careerId!: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(160)
  degree?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(180)
  guideName?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(180)
  coGuideName?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(180)
  reviewerOneName?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(180)
  reviewerTwoName?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  defenseDate?: string | null;
}

export class FindTitulationStudentsDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  search!: string;
}

export class UpdateTitulationDto {
  @IsOptional()
  @IsEnum(TitulationOutcome)
  outcome?: TitulationOutcome;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  studentName?: string;

  @IsOptional()
  @Transform(trimRut)
  @IsString()
  @MaxLength(12)
  @IsChileanRut()
  studentRut?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsEmail()
  @MaxLength(254)
  studentEmail?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @Matches(/^\+?[0-9().\s-]{8,24}$/)
  studentPhone?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(2000)
  thesisTopic?: string | null;

  @IsOptional()
  @IsUUID()
  careerId?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(160)
  degree?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(180)
  guideName?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(180)
  coGuideName?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(180)
  reviewerOneName?: string | null;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(180)
  reviewerTwoName?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  defenseDate?: string | null;

  @IsOptional()
  @IsEnum(TitulationStage)
  stage?: TitulationStage;

  @IsOptional()
  @IsEnum(TitulationDocumentStatus)
  defenseAnnexesStatus?: TitulationDocumentStatus;

  @IsOptional()
  @IsEnum(TitulationDocumentStatus)
  thesisSummaryStatus?: TitulationDocumentStatus;

  @IsOptional()
  @IsEnum(TitulationDocumentStatus)
  libraryFormStatus?: TitulationDocumentStatus;

  @IsOptional()
  @IsEnum(TitulationDocumentStatus)
  actaStatus?: TitulationDocumentStatus;

  @IsOptional()
  @IsEnum(TitulationDocumentStatus)
  evaluationsStatus?: TitulationDocumentStatus;
}
