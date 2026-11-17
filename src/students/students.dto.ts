import { Transform, Type } from 'class-transformer';
import { CourseAttemptOutcome } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Matches,
  IsDateString,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class StudentInputDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  givenNames?: string | null;

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
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  rut?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  personalEmail?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^\d{4}(10|20)$/)
  admission?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  paternalSurname?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  maternalSurname?: string | null;

  @IsOptional()
  @IsDateString()
  birthDate?: string | null;

  @IsOptional()
  @IsUUID()
  careerId?: string | null;

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

  @IsOptional()
  @IsUUID()
  careerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  cohortYear?: number;

  @IsOptional()
  @IsIn(['name', 'surname'])
  sortBy?: 'name' | 'surname';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class ImportStudentsDto {
  @IsOptional() @IsUUID() semesterId?: string;
  @IsString() @IsNotEmpty() @MaxLength(2_000_000) csv!: string;
}
