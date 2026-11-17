import {
  ArgsType,
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
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  MinLength,
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
  @Field()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  assistantshipNrc!: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  teachingAssignmentId?: string;
  @Field(() => ID) @IsUUID() semesterId!: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  courseId?: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  careerId?: string;
  @Field(() => ID)
  @IsUUID()
  studentId!: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  tariffId?: string;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  courseNrc?: string;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  studentCode?: string;
  @Field() @IsDateString({ strict: true }) approvedOn!: string;
  @Field() @IsDateString({ strict: true }) startsOn!: string;
  @Field() @IsDateString({ strict: true }) endsOn!: string;
  @Field() @IsBoolean() approvalConfirmed!: boolean;
  @Field(() => Float)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(168)
  weeklyHours!: number;
  @Field(() => [AssistantshipScheduleInput])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => AssistantshipScheduleInput)
  schedules!: AssistantshipScheduleInput[];
}

@InputType()
export class SaveAssistantshipTariffInput {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  id?: string;

  @Field(() => ID)
  @IsUUID()
  semesterId!: string;

  @Field()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @Field(() => Float)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000_000)
  monthlyRateClp!: number;
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
  @Field(() => ID, { nullable: true }) teachingAssignmentId!: string | null;
  @Field(() => ID, { nullable: true }) studentId!: string | null;
  @Field(() => ID) courseId!: string;
  @Field(() => ID, { nullable: true }) careerId!: string | null;
  @Field(() => ID, { nullable: true }) careerCurriculumVersionId!:
    string | null;
  @Field(() => String, { nullable: true }) careerName!: string | null;
  @Field(() => String, { nullable: true }) assistantshipNrc!: string | null;
  @Field() assistantName!: string;
  @Field() assistantEmail!: string;
  @Field(() => String, { nullable: true }) studentCode!: string | null;
  @Field() courseName!: string;
  @Field(() => String, { nullable: true }) courseCode!: string | null;
  @Field(() => String, { nullable: true }) nrc!: string | null;
  @Field(() => String, { nullable: true }) teacherName!: string | null;
  @Field(() => ID) semesterId!: string;
  @Field() semesterName!: string;
  @Field() approvedOn!: string;
  @Field() startsOn!: string;
  @Field(() => String, { nullable: true }) endsOn!: string | null;
  @Field(() => Float, { nullable: true }) weeklyHours!: number | null;
  @Field(() => ID, { nullable: true }) tariffId!: string | null;
  @Field(() => String, { nullable: true }) tariffName!: string | null;
  @Field(() => Float, { nullable: true }) tariffRateClp!: number | null;
  @Field(() => Float, { nullable: true }) estimatedAmountClp!: number | null;
  @Field(() => AssistantshipState) state!: AssistantshipState;
  @Field(() => [AssistantshipScheduleView])
  schedules!: AssistantshipScheduleView[];
}

@ObjectType()
export class AssistantshipTariffOption {
  @Field(() => ID) id!: string;
  @Field(() => ID) semesterId!: string;
  @Field() name!: string;
  @Field(() => Float) monthlyRateClp!: number;
}

@ObjectType()
export class AssistantshipBudgetSummary {
  @Field(() => ID) semesterId!: string;
  @Field() semesterName!: string;
  @Field(() => Float) allocatedAmountClp!: number;
  @Field(() => Float) occupiedAmountClp!: number;
  @Field(() => Float) percentage!: number;
  @Field(() => Int) assistantships!: number;
  @Field(() => Int) unpricedCount!: number;
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
  @Field(() => [AssistantshipCareerOption])
  careers!: AssistantshipCareerOption[];
  @Field(() => [AssistantshipBlockOption])
  blocks!: AssistantshipBlockOption[];
  @Field(() => [AssistantshipSemesterOption])
  semesters!: AssistantshipSemesterOption[];
  @Field(() => [AssistantshipTeacherOption])
  teachers!: AssistantshipTeacherOption[];
}

@ObjectType()
export class AssistantshipCurriculumOption {
  @Field(() => ID) id!: string;
  @Field(() => Int) cohortYear!: number;
}

@ObjectType()
export class AssistantshipCareerOption {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field() isActive!: boolean;
  @Field(() => [AssistantshipCurriculumOption])
  curriculumVersions!: AssistantshipCurriculumOption[];
}

@ObjectType()
export class AssistantshipStudentOption {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field() email!: string;
  @Field(() => String, { nullable: true }) rut!: string | null;
  @Field(() => ID, { nullable: true }) careerCurriculumVersionId!:
    string | null;
  @Field(() => ID, { nullable: true }) careerId!: string | null;
  @Field(() => String, { nullable: true }) careerName!: string | null;
}

@ArgsType()
export class AssistantshipStudentsArgs {
  @Field(() => String)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  search!: string;
}

@ObjectType()
export class AssistantshipCourseOption {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field(() => String, { nullable: true }) code!: string | null;
}

@ObjectType()
export class AssistantshipAssignmentOption {
  @Field(() => ID) id!: string;
  @Field() courseName!: string;
  @Field(() => String, { nullable: true }) courseCode!: string | null;
  @Field() nrc!: string;
  @Field() teacherName!: string;
}
