import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateTeacherDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  employeeCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  joinedOn?: string;

  @IsOptional()
  @IsDateString()
  leftOn?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  academicDegree?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  professionalTitle?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  institution?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  nrcs?: string[];
}

export class ToggleTeacherStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
