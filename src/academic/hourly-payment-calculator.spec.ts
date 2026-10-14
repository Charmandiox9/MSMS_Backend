import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  calculateHourlyPayment,
  contractDate,
} from './hourly-payment-calculator';

const payment = (start: string, end: string, rate = '52000', hours = '3') =>
  calculateHourlyPayment({
    hourlyRateClp: new Prisma.Decimal(rate),
    directHours: new Prisma.Decimal(hours),
    startsOn: contractDate(start),
    endsOn: contractDate(end),
  });

describe('Pagos PH con meses comerciales de 30 días', () => {
  it('reproduce la primera línea de la planilla original', () => {
    expect(payment('2026-08-17', '2026-12-19')).toEqual({
      monthlyAmountClp: '156000.00',
      months: [
        { month: '2026-08', days: 14, amountClp: '72800' },
        { month: '2026-09', days: 30, amountClp: '156000' },
        { month: '2026-10', days: 30, amountClp: '156000' },
        { month: '2026-11', days: 30, amountClp: '156000' },
        { month: '2026-12', days: 19, amountClp: '98800' },
      ],
      totalAmountClp: '639600',
    });
  });
  it('reproduce el caso de doctor antiguo con certificación nivel 3', () => {
    expect(payment('2026-08-17', '2026-12-19', '79000').totalAmountClp).toBe(
      '971700',
    );
  });
  it('paga solo noviembre para un contrato de un mes', () => {
    expect(payment('2026-11-01', '2026-11-30', '62000').totalAmountClp).toBe(
      '186000',
    );
  });
  it.each([
    ['2026-01-01', '2026-01-31'],
    ['2026-02-01', '2026-02-28'],
    ['2028-02-01', '2028-02-29'],
  ])('paga un mes completo entre %s y %s', (start, end) => {
    expect(payment(start, end).totalAmountClp).toBe('156000');
  });
  it('incluye el mismo día de inicio y fin y admite horas fraccionarias', () => {
    expect(
      payment('2026-08-17', '2026-08-17', '73000', '1.5').totalAmountClp,
    ).toBe('3650');
  });
  it('limita el día 31 al día comercial 30', () => {
    expect(payment('2026-08-31', '2026-08-31').months[0].days).toBe(1);
  });
  it('cruza diciembre y enero sin perder meses', () => {
    expect(
      payment('2026-12-15', '2027-01-10').months.map((month) => month.month),
    ).toEqual(['2026-12', '2027-01']);
  });
  it('redondea cada pago mensual a pesos enteros y suma esos pagos', () => {
    expect(payment('2026-08-30', '2026-09-01', '100', '1').totalAmountClp).toBe(
      '6',
    );
  });
  it('rechaza fechas imposibles y períodos invertidos', () => {
    expect(() => contractDate('2027-06-31')).toThrow(BadRequestException);
    expect(() => contractDate('2026-02-30')).toThrow(BadRequestException);
    expect(() => payment('2026-12-19', '2026-08-17')).toThrow(
      BadRequestException,
    );
  });
  it.each([
    ['0', '3'],
    ['-1', '3'],
    ['52000', '0'],
    ['52000', '169'],
  ])('rechaza tarifa %s y horas %s', (rate, hours) => {
    expect(() => payment('2026-08-01', '2026-12-30', rate, hours)).toThrow(
      BadRequestException,
    );
  });
});
