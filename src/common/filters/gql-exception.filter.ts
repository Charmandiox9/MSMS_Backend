import {
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  GqlExceptionFilter as NestGqlExceptionFilter,
  GqlArgumentsHost,
} from '@nestjs/graphql';
import { GraphQLError } from 'graphql';

/**
 * Global GraphQL exception filter.
 * Transforms NestJS HTTP exceptions into structured GraphQL errors
 * with a `code` extension for client-side error handling.
 */
@Catch()
export class GqlExceptionFilter implements NestGqlExceptionFilter {
  private readonly logger = new Logger(GqlExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): GraphQLError {
    GqlArgumentsHost.create(host);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      const message =
        typeof response === 'object' && 'message' in response
          ? (response as Record<string, unknown>).message
          : exception.message;

      this.logger.warn(`[GraphQL] ${status} - ${JSON.stringify(message)}`);

      return new GraphQLError(
        Array.isArray(message) ? message.join(', ') : String(message),
        {
          extensions: {
            code: this.httpStatusToCode(status),
            status,
          },
        },
      );
    }

    this.logger.error('[GraphQL] Unhandled exception', exception);

    return new GraphQLError('Internal server error', {
      extensions: { code: 'INTERNAL_SERVER_ERROR', status: 500 },
    });
  }

  private httpStatusToCode(status: number): string {
    const map: Record<number, string> = {
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
    };
    return map[status] ?? 'INTERNAL_SERVER_ERROR';
  }
}
