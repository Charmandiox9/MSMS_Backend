import { ExecutionContext } from '@nestjs/common';
import { getRequestFromContext } from './execution-context.util';

describe('getRequestFromContext', () => {
  it('retorna el request desde el contexto HTTP', () => {
    const request = { id: 'http-request' };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    expect(getRequestFromContext(context)).toBe(request);
  });

  it('retorna el request desde el contexto GraphQL', () => {
    const request = { id: 'graphql-request' };
    const context = {
      getType: () => 'graphql',
      getHandler: () => ({}),
      getClass: () => ({}),
      getArgs: () => [{}, {}, { req: request }, {}],
      switchToHttp: () => ({}),
    } as unknown as ExecutionContext;

    expect(getRequestFromContext(context)).toBe(request);
  });
});
