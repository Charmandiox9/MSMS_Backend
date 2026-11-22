import { EditorialFileKind, EditorialLanguage } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ReserveEditorialFile {
  @IsUUID()
  entryId!: string;

  @IsEnum(EditorialFileKind)
  kind!: EditorialFileKind;

  @IsEnum(EditorialLanguage)
  language!: EditorialLanguage;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fileName!: string;

  @IsOptional()
  @IsUUID()
  videoId?: string;
}

export class EditorialFileAccessInput {
  @IsOptional()
  @IsBoolean()
  preview?: boolean;
}
