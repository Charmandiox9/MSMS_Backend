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

// REST matches teacher maintenance and keeps the payment calculation in one backend.
@Controller('academic/hourly-payments')
@Roles('ACADEMIC_SECRETARY')
export class HourlyPaymentsController {
  constructor(private readonly service: HourlyPaymentsService) {}

  @Get('rates')
  @Roles('ACADEMIC_SECRETARY', 'ACADEMIC_PROCESS_ANALYST')
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
  @Roles('ACADEMIC_SECRETARY', 'ACADEMIC_PROCESS_ANALYST')
  teacherContracts(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.teacherContracts(id);
  }
}
