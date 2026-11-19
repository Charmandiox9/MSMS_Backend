import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SaveDepartmentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  code?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class DepartmentVersionDto {
  @IsDateString({ strict: true })
  updatedAt!: string;
}

export class UpdateDepartmentDto extends SaveDepartmentDto {
  @IsDateString({ strict: true })
  updatedAt!: string;
}
