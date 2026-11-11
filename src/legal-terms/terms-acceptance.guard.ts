import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { getRequestFromContext } from '../common/utils/execution-context.util';
import {
  SKIP_TERMS_ACCEPTANCE,
} from './skip-terms-acceptance.decorator';
import { TermsService } from './terms.service';

@Injectable()
export class TermsAcceptanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly termsService: TermsService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(SKIP_TERMS_ACCEPTANCE, targets)
    ) {
      return true;
    }

    const user = getRequestFromContext(context).user;
    const userId = user?.id;
    if (!userId) return true;

    if (!(await this.termsService.hasAcceptedCurrentVersion(userId))) {
      throw new ForbiddenException({
        code: 'TERMS_ACCEPTANCE_REQUIRED',
        message: 'Debe aceptar los términos vigentes para continuar',
      });
    }

    return true;
  }
}
