import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Basic request info
    const req = context.switchToHttp().getRequest<Request>();
    const method = req?.method || 'GraphQL/Other';
    const url = req?.url?.split('?')[0] || '';

    const now = Date.now();
    return next
      .handle()
      .pipe(
        tap(() =>
          this.logger.log(`[${method}] ${url} - ${Date.now() - now}ms`),
        ),
      );
  }
}
