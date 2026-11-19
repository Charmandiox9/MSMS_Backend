import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AssistantshipApplicationSubmissionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  externalResponseId!: string;
  @Transform(trim) @IsEmail() @MaxLength(254) studentEmail!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(180) name!: string;
  @Transform(trim) @Matches(/^\d{1,2}(?:\.?\d{3}){2}-?[0-9kK]$/) rut!: string;
  @Transform(trim)
  @Matches(/^(?=(?:\D*\d){7})\+?[\d\s().-]{7,31}$/)
  phone!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  submittedCareer!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(300) address!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) subject!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  motivation!: string;
  @Transform(trim) @Matches(/^\d{1,3}(?:[.,]\d{1,2})?$/) ppa!: string;
  @IsDateString({ strict: true }) submittedAt!: string;
}

export class AssistantshipApplicationDecisionDto {
  @IsIn(['APPROVED', 'REJECTED']) status!: 'APPROVED' | 'REJECTED';
  @IsBoolean() notify!: boolean;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}
