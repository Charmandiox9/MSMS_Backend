import { Controller, Get, Header, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ListSystemAuditQuery } from './system-audit.dto';
import { SystemAuditService } from './system-audit.service';

@Controller('system-audit')
@Roles('SYSTEM_ADMIN')
export class SystemAuditController {
  constructor(private readonly audit: SystemAuditService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: ListSystemAuditQuery) {
    return this.audit.list(query);
  }
}
