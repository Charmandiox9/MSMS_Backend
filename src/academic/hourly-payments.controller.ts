import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  HourlyPaymentPreviewDto,
  HourlyPayRateDto,
} from './hourly-payments.dto';
import { HourlyPaymentsService } from './hourly-payments.service';
import { ACADEMIC_REPOSITORY_ROLES } from './repository-access';

// REST matches teacher maintenance and keeps the payment calculation in one backend.
@Controller('academic/hourly-payments')
@Roles(...ACADEMIC_REPOSITORY_ROLES)
export class HourlyPaymentsController {
  constructor(private readonly service: HourlyPaymentsService) {}

  @Get('rates')
  @Roles(...ACADEMIC_REPOSITORY_ROLES)
  catalog() {
    return this.service.catalog();
  }

  @Post('rates')
  setRate(@Body() input: HourlyPayRateDto) {
    return this.service.setRate(input);
  }

  @Post('preview')
  preview(@Body() input: HourlyPaymentPreviewDto) {
    return this.service.preview(input);
  }

  @Get('teachers/:id')
  @Roles(...ACADEMIC_REPOSITORY_ROLES)
  teacherContracts(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.teacherContracts(id);
  }
}
