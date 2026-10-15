import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface HourlyPaymentCalculation {
  monthlyAmountClp: string;
  months: { month: string; days: number; amountClp: string }[];
  totalAmountClp: string;
}

export function contractDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('La fecha del contrato no es válida');
  return date;
}

/** Inclusive dates, 30-day commercial months; full calendar months always pay 30 days. */
export function calculateHourlyPayment(input: {
  hourlyRateClp: Prisma.Decimal;
  directHours: Prisma.Decimal;
  startsOn: Date;
  endsOn: Date;
}): HourlyPaymentCalculation {
  const { hourlyRateClp, directHours, startsOn, endsOn } = input;
  if (
    !hourlyRateClp.isFinite() ||
    hourlyRateClp.lte(0) ||
    !directHours.isFinite() ||
    directHours.lte(0) ||
    directHours.gt(168)
  )
    throw new BadRequestException(
      'Tarifa y horas deben ser positivas y válidas',
    );
  if (
    !Number.isFinite(startsOn.getTime()) ||
    !Number.isFinite(endsOn.getTime()) ||
    endsOn < startsOn
  )
    throw new BadRequestException(
      'El término del contrato debe ser igual o posterior al inicio',
    );
  const monthly = hourlyRateClp.mul(directHours);
  const months: HourlyPaymentCalculation['months'] = [];
  let total = new Prisma.Decimal(0);
  for (
    let cursor = new Date(
      Date.UTC(startsOn.getUTCFullYear(), startsOn.getUTCMonth(), 1),
    );
    cursor <= endsOn;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  ) {
    if (months.length >= 120)
      throw new BadRequestException('El contrato no puede superar 120 meses');
    const last = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0),
    );
    const from = startsOn > cursor ? Math.min(startsOn.getUTCDate(), 30) : 1;
    const to = endsOn < last ? Math.min(endsOn.getUTCDate(), 30) : 30;
    const days = to - from + 1;
    const amount = monthly
      .mul(days)
      .div(30)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    total = total.add(amount);
    months.push({
      month: cursor.toISOString().slice(0, 7),
      days,
      amountClp: amount.toFixed(0),
    });
  }
  return {
    monthlyAmountClp: monthly.toFixed(2),
    months,
    totalAmountClp: total.toFixed(0),
  };
}
