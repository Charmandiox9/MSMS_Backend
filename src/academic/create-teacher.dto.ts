import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTeacherDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @Transform(trim)
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(120)
  email!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  employeeCode?: string;

  @IsOptional()
  @IsDateString()
  joinedOn?: string;

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
