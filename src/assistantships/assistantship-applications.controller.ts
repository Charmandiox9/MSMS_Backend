import { createHash, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssistantshipApplicationStatus } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { AssistantshipsGuard } from './assistantships.guard';
import {
  AssistantshipApplicationDecisionDto,
  AssistantshipApplicationSubmissionDto,
} from './assistantship-applications.dto';
import { AssistantshipApplicationsService } from './assistantship-applications.service';

const digest = (value: string) => createHash('sha256').update(value).digest();

@Controller('academic/assistantship-applications')
export class AssistantshipApplicationsController {
  constructor(
    private readonly service: AssistantshipApplicationsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('inbox')
  receive(
    @Headers('x-marsys-forms-secret') secret: string | undefined,
    @Body() input: AssistantshipApplicationSubmissionDto,
  ) {
    const expected = this.config
      .get<string>('ASSISTANTSHIP_FORMS_WEBHOOK_SECRET')
      ?.trim();
    if (
      !expected ||
      !secret ||
      !timingSafeEqual(digest(secret.trim()), digest(expected))
    )
      throw new UnauthorizedException('Webhook no autorizado');
    return this.service.receive(input);
  }

  @UseGuards(AssistantshipsGuard)
  @Get()
  list(
    @Query(
      'status',
      new DefaultValuePipe('PENDING'),
      new ParseEnumPipe(AssistantshipApplicationStatus),
    )
    status: AssistantshipApplicationStatus,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    if (page < 1 || page > 10_000)
      throw new BadRequestException('Página inválida');
    return this.service.list(status, page);
  }

  @UseGuards(AssistantshipsGuard)
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @UseGuards(AssistantshipsGuard)
  @Patch(':id/decision')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: AssistantshipApplicationDecisionDto,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ) {
    if (!user?.id)
      throw new UnauthorizedException('Usuario autenticado inválido');
    return this.service.decide(id, user.id, input);
  }
}
