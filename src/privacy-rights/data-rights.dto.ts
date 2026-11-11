import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DataRightsRequestStatus, DataRightsRequestType } from '@prisma/client';

export class CreateDataRightsRequestDto {
  @IsEnum(DataRightsRequestType)
  rightType!: DataRightsRequestType;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  details?: string;
}

export class UpdateDataRightsRequestDto {
  @IsEnum(DataRightsRequestStatus)
  status!: DataRightsRequestStatus;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  responseNote?: string;
}

export class ExtendDataRightsRequestDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;
}

export class DataRightsRequestPageDto {
  @Transform(({ value }: { value: unknown }) =>
    value === undefined ? 1 : Number(value),
  )
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @Transform(({ value }: { value: unknown }) =>
    value === undefined ? 20 : Number(value),
  )
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}
