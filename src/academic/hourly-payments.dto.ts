import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AcademicDegree,
  HourlyTeacherCategory,
  TeacherCertification,
  TeachingComponent,
} from '@prisma/client';

export class HourlyContractDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  nrc!: string;

  @IsUUID()
  payRateId!: string;

  @IsEnum(TeachingComponent)
  component!: TeachingComponent;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  parallel!: string;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(168)
  directHours!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startsOn!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endsOn!: string;
}

export class HourlyPaymentPreviewDto {
  @IsUUID()
  semesterId!: string;

  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => HourlyContractDto)
  contracts!: HourlyContractDto[];
}

export class HourlyPayRateDto {
  @IsUUID()
  semesterId!: string;

  @IsEnum(HourlyTeacherCategory)
  category!: HourlyTeacherCategory;

  @IsEnum(AcademicDegree)
  academicDegree!: AcademicDegree;

  @IsEnum(TeacherCertification)
  certification!: TeacherCertification;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(9999999999.99)
  hourlyRateClp!: number;
}
