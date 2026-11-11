import { Transform, Type } from 'class-transformer';
import { CourseAttemptOutcome } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class StudentInputDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsUUID()
  careerCurriculumVersionId?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  semesterId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((item: unknown) =>
          typeof item === 'string' ? item.trim() : item,
        )
      : value,
  )
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(50, { each: true })
  nrcs?: string[];
}

export class StudentCourseAttemptInputDto {
  @IsUUID()
  courseId!: string;

  @IsUUID()
  semesterId!: string;

  @IsEnum(CourseAttemptOutcome)
  outcome!: CourseAttemptOutcome;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  nrc?: string;
}

export class ListStudentsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 10;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  nrc?: string;
}

export class ImportStudentsDto {
  @IsUUID() semesterId!: string;
  @IsString() @IsNotEmpty() @MaxLength(2_000_000) csv!: string;
}
