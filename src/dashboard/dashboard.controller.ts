import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('system-admin')
  @Roles('SYSTEM_ADMIN')
  systemAdmin() { return this.dashboard.systemAdmin(); }

  @Get('academic-secretary')
  @Roles('ACADEMIC_SECRETARY')
  academicSecretary() { return this.dashboard.academicSecretary(); }

  @Get('academic-process-analyst')
  @Roles('ACADEMIC_PROCESS_ANALYST')
  academicProcessAnalyst() { return this.dashboard.academicProcessAnalyst(); }

  @Get('teaching-support-coordinator')
  @Roles('TEACHING_SUPPORT_COORDINATOR')
  teachingSupportCoordinator() { return this.dashboard.teachingSupportCoordinator(); }
}
