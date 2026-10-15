import {
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { ProjectStatus, ResearchOutputKind } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

registerEnumType(ProjectStatus, { name: 'ProjectStatus' });
registerEnumType(ResearchOutputKind, { name: 'ResearchOutputKind' });

@InputType()
export class RepositoryListFilters {
  @Field(() => Int, { defaultValue: 1 }) @IsInt() @Min(1) page = 1;
  @Field(() => Int, { defaultValue: 10 }) @IsInt() @Min(1) @Max(100) pageSize =
    10;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @Field(() => ProjectStatus, { nullable: true })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2200)
  reportingYear?: number;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsIn([
    'title',
    'reportingYear',
    'startsOn',
    'totalAmount',
    'status',
    'createdAt',
  ])
  sortBy?: string;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

@ObjectType()
export class RepositoryParticipantView {
  @Field(() => ID, { nullable: true }) id?: string;
  @Field() name!: string;
  @Field() role!: string;
  @Field(() => ID, { nullable: true }) teacherId!: string | null;
  @Field(() => String, { nullable: true }) contactEmail?: string | null;
  @Field(() => String, { nullable: true }) gender?: string | null;
}

@ObjectType()
export class RepositoryListRecord {
  @Field(() => ID) id!: string;
  @Field() title!: string;
  @Field() academicUnit!: string;
  @Field(() => String, { nullable: true }) code!: string | null;
  @Field(() => Date, { nullable: true }) startsOn!: Date | null;
  @Field(() => Date, { nullable: true }) endsOn!: Date | null;
  @Field(() => Date) updatedAt!: Date;
  @Field(() => Date) createdAt!: Date;
  @Field(() => [RepositoryParticipantView])
  participants!: RepositoryParticipantView[];
  @Field(() => Int) outputCount!: number;
  @Field(() => Int, { nullable: true }) reportingYear?: number | null;
  @Field(() => ProjectStatus, { nullable: true }) status?: ProjectStatus | null;
  @Field(() => String, { nullable: true }) researchArea?: string | null;
}

@ObjectType()
export class RepositoryListPage {
  @Field(() => [RepositoryListRecord]) items!: RepositoryListRecord[];
  @Field(() => Int) total!: number;
  @Field(() => Int) page!: number;
  @Field(() => Int) pageSize!: number;
  @Field(() => Int) totalPages!: number;
}

@InputType()
export class ResearchOutputListFilters {
  @Field(() => Int, { defaultValue: 1 }) @IsInt() @Min(1) page = 1;
  @Field(() => Int, { defaultValue: 10 }) @IsInt() @Min(1) @Max(100) pageSize =
    10;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  researchId?: string;
  @Field(() => ResearchOutputKind, { nullable: true })
  @IsOptional()
  @IsEnum(ResearchOutputKind)
  kind?: ResearchOutputKind;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2200)
  reportingYear?: number;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsIn(['title', 'reportingYear', 'publicationDate', 'createdAt', 'kind'])
  sortBy?: string;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

@ObjectType()
export class ResearchOutputAuthorView {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field(() => Int) position!: number;
  @Field(() => String, { nullable: true }) affiliation!: string | null;
  @Field(() => Boolean, { nullable: true }) isStudent!: boolean | null;
  @Field(() => ID, { nullable: true }) teacherId!: string | null;
  @Field(() => ID, { nullable: true }) studentId!: string | null;
}

@ObjectType()
export class ResearchOutputResearchView {
  @Field(() => ID) id!: string;
  @Field() title!: string;
  @Field(() => String, { nullable: true }) code!: string | null;
}

@ObjectType()
export class ResearchOutputProjectView {
  @Field(() => ID) id!: string;
  @Field() title!: string;
  @Field(() => String, { nullable: true }) code!: string | null;
}

@ObjectType()
export class ResearchOutputProjectLinkView {
  @Field(() => ResearchOutputProjectView) project!: ResearchOutputProjectView;
}

@ObjectType()
export class ResearchOutputListRecord {
  @Field(() => ID) id!: string;
  @Field(() => ID, { nullable: true }) researchId!: string | null;
  @Field(() => ResearchOutputKind) kind!: ResearchOutputKind;
  @Field(() => Int) reportingYear!: number;
  @Field() title!: string;
  @Field(() => String, { nullable: true }) doi!: string | null;
  @Field(() => String, { nullable: true }) journal!: string | null;
  @Field(() => String, { nullable: true }) issn!: string | null;
  @Field(() => String, { nullable: true }) isbn!: string | null;
  @Field(() => String, { nullable: true }) quartile!: string | null;
  @Field(() => String, { nullable: true }) fiveYearImpactFactor!: string | null;
  @Field(() => Date, { nullable: true }) publicationDate!: Date | null;
  @Field(() => String, { nullable: true }) indexation!: string | null;
  @Field(() => String, { nullable: true }) publisher!: string | null;
  @Field(() => String, { nullable: true }) publicationPlace!: string | null;
  @Field(() => Boolean, { nullable: true }) studentParticipation!:
    boolean | null;
  @Field(() => Boolean, { nullable: true }) internationalParticipation!:
    boolean | null;
  @Field(() => String, { nullable: true }) intellectualPropertyType!:
    string | null;
  @Field(() => String, { nullable: true }) phase!: string | null;
  @Field(() => Date, { nullable: true }) phaseDate!: Date | null;
  @Field(() => String, { nullable: true }) notes!: string | null;
  @Field(() => Date) updatedAt!: Date;
  @Field(() => Date) createdAt!: Date;
  @Field(() => ResearchOutputResearchView, { nullable: true })
  research!: ResearchOutputResearchView | null;
  @Field(() => [ResearchOutputAuthorView]) authors!: ResearchOutputAuthorView[];
  @Field(() => [ResearchOutputProjectLinkView])
  projects!: ResearchOutputProjectLinkView[];
}

@ObjectType()
export class ResearchOutputListPage {
  @Field(() => [ResearchOutputListRecord]) items!: ResearchOutputListRecord[];
  @Field(() => Int) total!: number;
  @Field(() => Int) page!: number;
  @Field(() => Int) pageSize!: number;
  @Field(() => Int) totalPages!: number;
}
