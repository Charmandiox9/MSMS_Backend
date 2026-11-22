import {
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  EditorialDestination,
  EditorialFileKind,
  EditorialFileStatus,
  EditorialKind,
  EditorialLanguage,
  EditorialStatus,
  EditorialTopic,
} from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum EditorialFormat {
  TEXT = 'TEXT',
  PDF = 'PDF',
  VIDEO = 'VIDEO',
}

for (const [name, values] of Object.entries({
  EditorialDestination,
  EditorialFileKind,
  EditorialFileStatus,
  EditorialFormat,
  EditorialKind,
  EditorialLanguage,
  EditorialStatus,
  EditorialTopic,
})) {
  registerEnumType(values, { name });
}

@InputType()
export class EditorialFilters {
  @Field(() => EditorialKind, { nullable: true })
  @IsOptional()
  @IsEnum(EditorialKind)
  kind?: EditorialKind;

  @Field(() => EditorialTopic, { nullable: true })
  @IsOptional()
  @IsEnum(EditorialTopic)
  topic?: EditorialTopic;

  @Field(() => EditorialFormat, { nullable: true })
  @IsOptional()
  @IsEnum(EditorialFormat)
  format?: EditorialFormat;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @Field(() => Int, { defaultValue: 1 })
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;

  @Field(() => Int, { defaultValue: 20 })
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

@InputType()
export class EditorialVersionInput {
  @Field(() => ID)
  @IsUUID()
  id!: string;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  version!: number;
}

@InputType()
export class EditorialDraftInput extends EditorialVersionInput {
  @Field(() => EditorialTopic, { nullable: true })
  @IsOptional()
  @IsEnum(EditorialTopic)
  topic?: EditorialTopic;

  @Field()
  @IsString()
  @MaxLength(180)
  titleEs!: string;

  @Field()
  @IsString()
  @MaxLength(500)
  summaryEs!: string;

  @Field()
  @IsString()
  @MaxLength(12000)
  bodyEs!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  titleEn?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  summaryEn?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(12000)
  bodyEn?: string;

  @Field(() => EditorialDestination, { nullable: true })
  @IsOptional()
  @IsEnum(EditorialDestination)
  destination?: EditorialDestination;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  guideId?: string;

  @Field(() => [ID])
  @IsArray()
  @ArrayMaxSize(24)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  fileIds!: string[];
}

@ObjectType()
export class EditorialFileView {
  @Field(() => ID) id!: string;
  @Field(() => EditorialFileKind) kind!: EditorialFileKind;
  @Field(() => EditorialLanguage) language!: EditorialLanguage;
  @Field(() => EditorialFileStatus) status!: EditorialFileStatus;
  @Field() fileName!: string;
  @Field(() => Int, { nullable: true }) size!: number | null;
  @Field(() => Number, { nullable: true }) duration!: number | null;
  @Field(() => ID, { nullable: true }) videoId!: string | null;
}

@ObjectType()
export class EditorialRevisionView {
  @Field(() => Int) number!: number;
  @Field(() => EditorialTopic, { nullable: true })
  topic!: EditorialTopic | null;
  @Field() titleEs!: string;
  @Field() summaryEs!: string;
  @Field() bodyEs!: string;
  @Field(() => String, { nullable: true }) titleEn!: string | null;
  @Field(() => String, { nullable: true }) summaryEn!: string | null;
  @Field(() => String, { nullable: true }) bodyEn!: string | null;
  @Field(() => EditorialDestination, { nullable: true })
  destination!: EditorialDestination | null;
  @Field(() => ID, { nullable: true }) guideId!: string | null;
  @Field(() => [EditorialFileView]) files!: EditorialFileView[];
}

@ObjectType()
export class EditorialPublication {
  @Field(() => ID) id!: string;
  @Field(() => EditorialKind) kind!: EditorialKind;
  @Field() featured!: boolean;
  @Field(() => Date, { nullable: true }) firstPublishedAt!: Date | null;
  @Field(() => Date, { nullable: true }) publishedAt!: Date | null;
  @Field(() => EditorialRevisionView, { nullable: true })
  published!: EditorialRevisionView | null;
}

@ObjectType()
export class EditorialManagedEntry extends EditorialPublication {
  @Field(() => EditorialStatus) status!: EditorialStatus;
  @Field(() => Int) version!: number;
  @Field(() => Date) updatedAt!: Date;
  @Field(() => EditorialRevisionView, { nullable: true })
  draft!: EditorialRevisionView | null;
}

@ObjectType()
export class EditorialPage {
  @Field(() => [EditorialPublication]) items!: EditorialPublication[];
  @Field(() => Int) total!: number;
}

@ObjectType()
export class EditorialManagedPage {
  @Field(() => [EditorialManagedEntry]) items!: EditorialManagedEntry[];
  @Field(() => Int) total!: number;
}
