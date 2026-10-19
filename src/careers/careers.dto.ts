import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CurriculumCourseInputDto {
  @IsUUID()
  courseId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  termNumber!: number;
}

export class CurriculumVersionInputDto {
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  cohortYear!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => CurriculumCourseInputDto)
  courses!: CurriculumCourseInputDto[];
}

export class CreateCareerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  cohortYear!: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => CurriculumCourseInputDto)
  courses?: CurriculumCourseInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => CurriculumCourseNameInputDto)
  curriculumCourses?: CurriculumCourseNameInputDto[];
}

export class UpdateCareerDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AddCurriculumVersionDto extends CurriculumVersionInputDto {}

export class CurriculumCourseNameInputDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  courseName!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  termNumber!: number;
}

export class ImportCurriculumDto {
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  cohortYear!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => CurriculumCourseNameInputDto)
  courses!: CurriculumCourseNameInputDto[];
}

export class CreateCareerFromCsvDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  cohortYear!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => CurriculumCourseNameInputDto)
  courses!: CurriculumCourseNameInputDto[];
}

export class UpdateCurriculumVersionDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => CurriculumCourseInputDto)
  courses!: CurriculumCourseInputDto[];
}

