import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBase64,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class TeacherImportEmailDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.replace(/[.\s]/g, '').toUpperCase()
      : value,
  )
  @IsString()
  @Matches(/^\d{7,8}-[\dKk]$/)
  rut!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class WorkbookImportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(18_000_000)
  @IsBase64()
  fileBase64!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TeacherImportEmailDto)
  teacherEmails?: TeacherImportEmailDto[];
}
