import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { AcceptTermsDto, TermsQueryDto } from './terms.dto';
import { SkipTermsAcceptance } from './skip-terms-acceptance.decorator';
import { TermsService } from './terms.service';

@Controller('legal/terms')
export class TermsController {
  constructor(private readonly termsService: TermsService) {}

  @Public()
  @Get('current')
  getCurrent(@Query() query: TermsQueryDto) {
    return this.termsService.getCurrent(query.locale);
  }

  @SkipTermsAcceptance()
  @Get('status')
  getStatus(@CurrentUser() user: CurrentUserPayload) {
    return this.termsService.getStatus(user.id);
  }

  @SkipTermsAcceptance()
  @Post('accept')
  accept(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: AcceptTermsDto,
  ) {
    return this.termsService.accept(user.id, body.version, body.locale);
  }

  @SkipTermsAcceptance()
  @Get('acceptances')
  getHistory(@CurrentUser() user: CurrentUserPayload) {
    return this.termsService.getHistory(user.id);
  }
}
