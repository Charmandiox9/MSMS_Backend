import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

describe('tiempos por operación sin datos personales', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(['http', 'graphql'] as const)(
    'identifica operaciones %s y excluye argumentos y filtros',
    async (type) => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      jest.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(150);
      const req = { method: 'POST', url: '/api/graphql?search=private' };
      const context = {
        getType: () => type,
        getHandler: () => function academicCharts() {},
        getClass: () => Object,
        getArgs: () => [null, { search: 'private' }, { req }, null],
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;
      const handler: CallHandler = { handle: () => of('result') };
      await firstValueFrom(
        new LoggingInterceptor().intercept(context, handler),
      );
      expect(log).toHaveBeenCalledWith(
        type === 'graphql'
          ? '[POST] /api/graphql academicCharts - 50ms'
          : '[POST] /api/graphql - 50ms',
      );
      expect(log.mock.calls.flat().join(' ')).not.toContain('private');
    },
  );
});
