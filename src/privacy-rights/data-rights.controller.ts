import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreateDataRightsRequestDto,
  DataRightsRequestPageDto,
  ExtendDataRightsRequestDto,
  UpdateDataRightsRequestDto,
} from './data-rights.dto';
import { DataRightsService } from './data-rights.service';

@Controller('privacy/requests')
export class DataRightsController {
  constructor(private readonly service: DataRightsService) {}

  @Post()
  create(
    @Body() body: CreateDataRightsRequestDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.create(user.id, body.rightType, body.details);
  }

  @Get('mine')
  listMine(@CurrentUser() user: CurrentUserPayload) {
    return this.service.listMine(user.id);
  }

  @Get('queue')
  @Roles('PRIVACY_OFFICER')
  listQueue(@Query() query: DataRightsRequestPageDto) {
    return this.service.listQueue(query.page, query.pageSize);
  }

  @Patch(':id/status')
  @Roles('PRIVACY_OFFICER')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDataRightsRequestDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.updateStatus(
      id,
      body.status,
      user.id,
      body.responseNote,
    );
  }

  @Patch(':id/extend-deadline')
  @Roles('PRIVACY_OFFICER')
  extendDeadline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExtendDataRightsRequestDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.extendDeadline(id, user.id, body.note);
  }
}
