import { SystemAuditAction } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListSystemAuditQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @IsOptional()
  @IsEnum(SystemAuditAction)
  action?: SystemAuditAction;
}
