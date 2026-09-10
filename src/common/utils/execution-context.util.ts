import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Request } from 'express';

export function getRequestFromContext(context: ExecutionContext): Request {
  if (context.getType<'graphql'>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<{ req: Request }>()
      .req;
  }
  return context.switchToHttp().getRequest<Request>();
}
