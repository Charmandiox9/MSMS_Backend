import {
  Field,
  Float,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum AssistantshipState {
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
}
registerEnumType(AssistantshipState, { name: 'AssistantshipState' });

@InputType()
export class AssistantshipFilters {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  semesterId?: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  teacherId?: string;
  @Field(() => AssistantshipState, { nullable: true })
  @IsOptional()
  @IsEnum(AssistantshipState)
  state?: AssistantshipState;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
  @Field(() => Int, { defaultValue: 1 }) @IsInt() @Min(1) page = 1;
  @Field(() => Int, { defaultValue: 20 }) @IsInt() @Min(1) @Max(50) pageSize =
    20;
}

@InputType()
export class AssistantshipScheduleInput {
  @Field(() => Int) @IsInt() @Min(1) @Max(7) weekday!: number;
  @Field(() => Int) @IsInt() @Min(0) @Max(1439) startsAtMinute!: number;
  @Field(() => Int) @IsInt() @Min(1) @Max(1440) endsAtMinute!: number;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;
}

@InputType()
export class RegisterAssistantshipInput {
  @Field() @IsString() @IsNotEmpty() @MaxLength(50) assistantshipNrc!: string;
  @Field(() => ID) @IsUUID() teachingAssignmentId!: string;
  @Field()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  assistantName!: string;
  @Field()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  assistantEmail!: string;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  studentCode?: string;
  @Field() @IsDateString({ strict: true }) approvedOn!: string;
  @Field() @IsDateString({ strict: true }) startsOn!: string;
  @Field() @IsDateString({ strict: true }) endsOn!: string;
  @Field() @IsBoolean() approvalConfirmed!: boolean;
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(168)
  weeklyHours?: number;
  @Field(() => [AssistantshipScheduleInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => AssistantshipScheduleInput)
  schedules?: AssistantshipScheduleInput[];
}

@ObjectType()
export class AssistantshipScheduleView {
  @Field(() => Int) weekday!: number;
  @Field(() => Int) startsAtMinute!: number;
  @Field(() => Int) endsAtMinute!: number;
  @Field(() => String, { nullable: true }) location!: string | null;
}

@ObjectType()
export class AssistantshipView {
  @Field(() => ID) id!: string;
  @Field(() => ID) teachingAssignmentId!: string;
  @Field(() => String, { nullable: true }) assistantshipNrc!: string | null;
  @Field() assistantName!: string;
  @Field() assistantEmail!: string;
  @Field(() => String, { nullable: true }) studentCode!: string | null;
  @Field() courseName!: string;
  @Field(() => String, { nullable: true }) courseCode!: string | null;
  @Field() nrc!: string;
  @Field() teacherName!: string;
  @Field(() => ID) semesterId!: string;
  @Field() semesterName!: string;
  @Field() approvedOn!: string;
  @Field() startsOn!: string;
  @Field(() => String, { nullable: true }) endsOn!: string | null;
  @Field(() => Float, { nullable: true }) weeklyHours!: number | null;
  @Field(() => AssistantshipState) state!: AssistantshipState;
  @Field(() => [AssistantshipScheduleView])
  schedules!: AssistantshipScheduleView[];
}

@ObjectType()
export class AssistantshipPage {
  @Field(() => [AssistantshipView]) items!: AssistantshipView[];
  @Field(() => Int) total!: number;
  @Field(() => Int) assistants!: number;
  @Field(() => Int) semesters!: number;
  @Field(() => Int) page!: number;
  @Field(() => Int) totalPages!: number;
}

@ObjectType()
export class AssistantshipSemesterOption {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field() startsOn!: string;
  @Field() endsOn!: string;
  @Field() isActive!: boolean;
}

@ObjectType()
export class AssistantshipTeacherOption {
  @Field(() => ID) id!: string;
  @Field() name!: string;
}

@ObjectType()
export class AssistantshipBlockOption {
  @Field() code!: string;
  @Field(() => Int) startsAtMinute!: number;
  @Field(() => Int) endsAtMinute!: number;
}

@ObjectType()
export class AssistantshipOptions {
  @Field(() => [AssistantshipBlockOption])
  blocks!: AssistantshipBlockOption[];
  @Field(() => [AssistantshipSemesterOption])
  semesters!: AssistantshipSemesterOption[];
  @Field(() => [AssistantshipTeacherOption])
  teachers!: AssistantshipTeacherOption[];
}

@ObjectType()
export class AssistantshipAssignmentOption {
  @Field(() => ID) id!: string;
  @Field() courseName!: string;
  @Field(() => String, { nullable: true }) courseCode!: string | null;
  @Field() nrc!: string;
  @Field() teacherName!: string;
}
