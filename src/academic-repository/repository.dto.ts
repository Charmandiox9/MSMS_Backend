import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { ProjectStatus, ResearchOutputKind } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const optionalText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class RepositoryQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 10;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  reportingYear?: number;
  @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
  @IsOptional()
  @IsIn([
    'title',
    'reportingYear',
    'startsOn',
    'totalAmount',
    'status',
    'createdAt',
    'publicationDate',
    'kind',
  ])
  sortBy?:
    | 'title'
    | 'reportingYear'
    | 'startsOn'
    | 'totalAmount'
    | 'status'
    | 'createdAt'
    | 'publicationDate'
    | 'kind';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc';
}

export class RepositoryVersionDto {
  @IsDateString({ strict: true }) expectedUpdatedAt!: string;
}

export class ParticipantInputDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) role!: string;
  @IsOptional() @IsUUID() teacherId?: string | null;
  @IsOptional()
  @Transform(optionalText)
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(100) gender?:
    string | null;
}

export class RepositoryInputDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) title!: string;
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  academicUnit!: string;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(100) code?:
    string | null;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startsOn?: string | null;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endsOn?: string | null;
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ParticipantInputDto)
  participants?: ParticipantInputDto[];
}

export class ProjectInputDto extends RepositoryInputDto {
  @IsInt() @Min(1900) @Max(2200) reportingYear!: number;
  @IsEnum(ProjectStatus) status!: ProjectStatus;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(200) faculty?:
    string | null;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(200)
  resolution?: string | null;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(200)
  classification?: string | null;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(200)
  fundingSource?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(200) program?:
    string | null;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(200)
  competition?: string | null;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(200)
  applicationArea?: string | null;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(200)
  participationScope?: string | null;
  @IsOptional() @IsBoolean() officialized?: boolean | null;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  revisedEndsOn?: string | null;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  closedOn?: string | null;
  @IsOptional() @Transform(optionalText) @Matches(/^[A-Z]{3}$/) currency?:
    string | null;
  @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$/) totalAmount?: string | null;
  @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$/) vraContribution?:
    string | null;
  @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$/) vridtContribution?:
    string | null;
  @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$/) recoveryAmount?:
    string | null;
  @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$/) facultyContribution?:
    string | null;
  @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$/) depreciationAmount?:
    string | null;
  @IsOptional() @Matches(/^\d{1,16}(\.\d{1,2})?$/) profitabilityAmount?:
    string | null;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(2000)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  folderUrl?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(10000) notes?:
    string | null;
}

export class UpdateProjectDto extends ProjectInputDto {
  @IsDateString({ strict: true }) expectedUpdatedAt!: string;
}

export class ResearchInputDto extends RepositoryInputDto {
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(10000)
  description?: string | null;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(200)
  researchArea?: string | null;
}

export class UpdateResearchDto extends ResearchInputDto {
  @IsDateString({ strict: true }) expectedUpdatedAt!: string;
}

export class ResearchOutputQueryDto extends RepositoryQueryDto {
  @IsOptional() @IsUUID() researchId?: string;
  @IsOptional() @IsEnum(ResearchOutputKind) kind?: ResearchOutputKind;
}

export class ResearchOutputAuthorInputDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) position!: number;
  @IsOptional() @IsUUID() teacherId?: string | null;
  @IsOptional() @IsUUID() studentId?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(200) affiliation?: string | null;
  @IsOptional() @IsBoolean() isStudent?: boolean | null;
}

export class ResearchOutputInputDto {
  @IsUUID() researchId!: string;
  @IsEnum(ResearchOutputKind) kind!: ResearchOutputKind;
  @Type(() => Number) @IsInt() @Min(1900) @Max(2200) reportingYear!: number;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) title!: string;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(200) doi?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(500) journal?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(50) issn?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(50) isbn?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(20) quartile?: string | null;
  @IsOptional() @Matches(/^\d{1,6}(\.\d{1,4})?$/) fiveYearImpactFactor?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) publicationDate?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(200) indexation?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(300) publisher?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(200) publicationPlace?: string | null;
  @IsOptional() @IsBoolean() studentParticipation?: boolean | null;
  @IsOptional() @IsBoolean() internationalParticipation?: boolean | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(200) intellectualPropertyType?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(200) phase?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) phaseDate?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(10000) notes?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true }) projectIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ResearchOutputAuthorInputDto) authors?: ResearchOutputAuthorInputDto[];
}

export class UpdateResearchOutputDto extends ResearchOutputInputDto {
  @IsDateString({ strict: true }) expectedUpdatedAt!: string;
}
