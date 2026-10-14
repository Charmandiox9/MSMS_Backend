import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
  Matches,
} from 'class-validator';
import { AcademicDegree, TeacherCertification } from '@prisma/client';
import { HourlyContractDto } from './hourly-payments.dto';
import { UpdateCourseDto } from './update-course.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class TeacherInputDto {
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
  @MaxLength(50)
  employeeCode?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/\./g, '').replace(/\s/g, '').toUpperCase() || null
      : value,
  )
  @Matches(/^\d{7,8}-[\dK]$/)
  rut?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  academicUnit?: string | null;

  @IsOptional()
  @IsEnum(AcademicDegree)
  academicDegree?: AcademicDegree | null;

  @IsOptional()
  @IsEnum(TeacherCertification)
  certification?: TeacherCertification | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  joinedOn?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  leftOn?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => HourlyContractDto)
  hourlyContracts?: HourlyContractDto[];

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
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(50, { each: true })
  nrcs?: string[];
}

export class CreateCourseDto extends UpdateCourseDto {
  @IsUUID()
  semesterId!: string;
}

export class CourseTeachersDto {
  @IsUUID()
  semesterId!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  teacherIds!: string[];
}
