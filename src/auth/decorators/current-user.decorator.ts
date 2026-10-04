import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../active-user.service';
import { getRequestFromContext } from '../../common/utils/execution-context.util';

// JwtStrategy entrega AuthenticatedUser; SessionAuthGuard la sesión con `id` y `sub`.
export type CurrentUserPayload = AuthenticatedUser & { sub?: string };

export const CurrentUser = createParamDecorator(
  (
    _data: unknown,
    context: ExecutionContext,
  ): CurrentUserPayload | undefined => {
    return getRequestFromContext(context).user as
      CurrentUserPayload | undefined;
  },
);
