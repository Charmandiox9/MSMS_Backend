import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { SemesterBudgetsService } from './semester-budgets.service';
import { UpdateSemesterBudgetDto } from './semester-budgets.dto';

@Controller('academic/semesters/:semesterId/budget')
@Roles('ACADEMIC_SECRETARY')
export class SemesterBudgetSettingsController {
  constructor(private readonly budgets: SemesterBudgetsService) {}

  @Get()
  get(@Param('semesterId', ParseUUIDPipe) semesterId: string) {
    return this.budgets.get(semesterId);
  }

  @Put()
  update(
    @Param('semesterId', ParseUUIDPipe) semesterId: string,
    @Body() body: UpdateSemesterBudgetDto,
  ) {
    return this.budgets.update(semesterId, body);
  }
}

@Controller('dashboard')
export class SemesterBudgetAlertsController {
  constructor(private readonly budgets: SemesterBudgetsService) {}

  @Get('semester-budget-alerts')
  alerts(@CurrentUser() user: CurrentUserPayload) {
    return this.budgets.alerts(user.roles);
  }
}
