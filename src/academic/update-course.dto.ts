import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { academicScheduleBlocks } from './schedule-blocks';

export const academicScheduleDays = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CourseScheduleDto {
  @IsIn(academicScheduleDays)
  day!: string;

  @IsIn(academicScheduleBlocks.map((block) => block.code))
  block!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  location?: string | null;
}

export class UpdateCourseDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  nrc!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(academicScheduleDays.length * academicScheduleBlocks.length)
  @ValidateNested({ each: true })
  @Type(() => CourseScheduleDto)
  schedules!: CourseScheduleDto[];
}
