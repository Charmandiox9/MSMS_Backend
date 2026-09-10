import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';
import { getRequestFromContext } from '../../common/utils/execution-context.util';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User | undefined => {
    return getRequestFromContext(context).user;
  },
);
