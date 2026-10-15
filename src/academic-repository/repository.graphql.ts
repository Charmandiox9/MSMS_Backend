import {
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { ProjectStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

registerEnumType(ProjectStatus, { name: 'ProjectStatus' });

@InputType()
export class RepositoryListFilters {
  @Field(() => Int, { defaultValue: 1 }) @IsInt() @Min(1) page = 1;
  @Field(() => Int, { defaultValue: 10 }) @IsInt() @Min(1) @Max(100) pageSize =
    10;
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @Field({ nullable: true })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2200)
  reportingYear?: number;
  @Field({ nullable: true })
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
  @Field({ nullable: true }) @IsOptional() @IsIn(['asc', 'desc']) sortOrder?:
    'asc' | 'desc';
}

@ObjectType()
export class RepositoryParticipantView {
  @Field(() => ID, { nullable: true }) id?: string;
  @Field() name!: string;
  @Field() role!: string;
  @Field(() => ID, { nullable: true }) teacherId!: string | null;
  @Field({ nullable: true }) contactEmail?: string | null;
  @Field({ nullable: true }) gender?: string | null;
}

@ObjectType()
export class RepositoryListRecord {
  @Field(() => ID) id!: string;
  @Field() title!: string;
  @Field() academicUnit!: string;
  @Field({ nullable: true }) code!: string | null;
  @Field({ nullable: true }) startsOn!: Date | null;
  @Field({ nullable: true }) endsOn!: Date | null;
  @Field() updatedAt!: Date;
  @Field() createdAt!: Date;
  @Field(() => [RepositoryParticipantView])
  participants!: RepositoryParticipantView[];
  @Field(() => Int) outputCount!: number;
  @Field(() => Int, { nullable: true }) reportingYear?: number | null;
  @Field(() => ProjectStatus, { nullable: true }) status?: ProjectStatus | null;
  @Field({ nullable: true }) researchArea?: string | null;
}

@ObjectType()
export class RepositoryListPage {
  @Field(() => [RepositoryListRecord]) items!: RepositoryListRecord[];
  @Field(() => Int) total!: number;
  @Field(() => Int) page!: number;
  @Field(() => Int) pageSize!: number;
  @Field(() => Int) totalPages!: number;
}
