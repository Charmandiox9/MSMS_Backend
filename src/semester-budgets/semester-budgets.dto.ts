import { Type } from 'class-transformer';
import { SemesterBudgetCategoryCode } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class BudgetAllocationDto {
  @IsOptional()
  @IsEnum(SemesterBudgetCategoryCode)
  code?: SemesterBudgetCategoryCode;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000)
  amountClp!: number;
}

export class BudgetThresholdDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  percentage!: number;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleCodes!: string[];
}

export class UpdateSemesterBudgetDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  totalAmountClp!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BudgetAllocationDto)
  allocations!: BudgetAllocationDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BudgetThresholdDto)
  thresholds!: BudgetThresholdDto[];
}
