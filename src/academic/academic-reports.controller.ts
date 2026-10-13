import {
  Controller,
  Get,
  Query,
  UseGuards,
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { getRequestFromContext } from '../common/utils/execution-context.util';
import { AcademicReportsService } from './academic-reports.service';
import type { AcademicDataset } from './academic-reports.service';

export class AcademicReportQuery {
  @IsIn([
    'teachers',
    'courses',
    'assignments',
    'assistants',
    'assistantships',
    'semesters',
  ])
  dataset: AcademicDataset = 'assistantships';
  @IsOptional() @IsUUID() semesterId?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

@Injectable()
export class AcademicReportsGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const user = getRequestFromContext(context).user;
    if (!user?.id) throw new UnauthorizedException();
    const permission =
      context.getHandler().name === 'exportReport'
        ? 'REPORTS_EXPORT'
        : 'REPORTS_VIEW';
    const allowed = await this.prisma.user.findFirst({
      where: {
        id: user.id,
        isActive: true,
        userRoles: {
          some: {
            role: {
              permissions: { some: { permission: { code: permission } } },
            },
          },
        },
      },
      select: { id: true },
    });
    if (!allowed) throw new ForbiddenException();
    return true;
  }
}

@Controller('academic/reports')
@UseGuards(AcademicReportsGuard)
export class AcademicReportsController {
  constructor(private readonly reports: AcademicReportsService) {}
  @Get()
  list(@Query() query: AcademicReportQuery) {
    return this.reports.data(query.dataset, query.semesterId, query.search);
  }
  @Get('export')
  exportReport(@Query() query: AcademicReportQuery) {
    return this.reports.data(query.dataset, query.semesterId, query.search);
  }
}
