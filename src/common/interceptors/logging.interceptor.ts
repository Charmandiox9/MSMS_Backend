import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { getRequestFromContext } from '../utils/execution-context.util';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = getRequestFromContext(context);
    const method = req?.method || 'GraphQL/Other';
    const url = req?.url?.split('?')[0] || '';
    const operation =
      context.getType<'graphql'>() === 'graphql'
        ? ` ${context.getHandler().name}`
        : '';

    const now = Date.now();
    return next
      .handle()
      .pipe(
        tap(() =>
          this.logger.log(
            `[${method}] ${url}${operation} - ${Date.now() - now}ms`,
          ),
        ),
      );
  }
}
