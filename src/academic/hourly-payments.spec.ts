import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { HourlyPaymentsController } from './hourly-payments.controller';
import {
  HourlyContractDto,
  HourlyPaymentPreviewDto,
  HourlyPayRateDto,
} from './hourly-payments.dto';
import { HourlyPaymentsService } from './hourly-payments.service';

const semesterId = '11111111-1111-4111-8111-111111111111';
const rateId = '22222222-2222-4222-8222-222222222222';
const contractId = '33333333-3333-4333-8333-333333333333';
const teacherId = '44444444-4444-4444-8444-444444444444';
const line: HourlyContractDto = {
  nrc: '10001',
  payRateId: rateId,
  component: 'LABORATORY',
  parallel: 'L3',
  directHours: 3,
  startsOn: '2026-08-17',
  endsOn: '2026-12-19',
};
const rate = {
  id: rateId,
  semesterId,
  category: 'NEW',
  academicDegree: 'PROFESSIONAL',
  certification: 'NONE',
  hourlyRateClp: new Prisma.Decimal(52000),
};
const semester = {
  id: semesterId,
  startsOn: new Date('2026-08-17'),
  endsOn: new Date('2026-12-19'),
};

describe('Contratos y tarifas PH', () => {
  const prisma = {
    $transaction: jest.fn(),
    academicSemester: { findFirst: jest.fn() },
    hourlyPayRate: { findMany: jest.fn(), upsert: jest.fn() },
    hourlyTeachingContract: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    teacher: { findUnique: jest.fn() },
    teachingAssignment: { findMany: jest.fn() },
  };
  const service = new HourlyPaymentsService(prisma as unknown as PrismaService);
  const controller = new HourlyPaymentsController(service);
  const tx = prisma as unknown as Prisma.TransactionClient;
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (operation: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        operation(tx),
    );
    prisma.academicSemester.findFirst.mockResolvedValue(semester);
    prisma.hourlyPayRate.findMany.mockResolvedValue([rate]);
    prisma.hourlyTeachingContract.findMany.mockResolvedValue([]);
    prisma.teachingAssignment.findMany.mockResolvedValue([
      { id: 'assignment', nrc: '10001' },
    ]);
    prisma.teacher.findUnique.mockResolvedValue({ id: teacherId });
  });

  it('previsualiza con la tarifa persistida y no escribe datos', async () => {
    expect(
      await controller.preview({ semesterId, contracts: [line] }),
    ).toMatchObject({ totalAmountClp: '639600' });
    expect(prisma.hourlyTeachingContract.create).not.toHaveBeenCalled();
    expect(prisma.hourlyPayRate.upsert).not.toHaveBeenCalled();
  });
  it('rechaza un semestre desactualizado, una tarifa ajena y fechas fuera del semestre', async () => {
    await expect(
      service.preview({ semesterId: 'old', contracts: [line] }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.preview({
        semesterId,
        contracts: [{ ...line, payRateId: 'other' }],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.preview({
        semesterId,
        contracts: [{ ...line, startsOn: '2026-07-31' }],
      }),
    ).rejects.toThrow(BadRequestException);
  });
  it('rechaza componentes duplicados pero admite paralelos distintos', async () => {
    await expect(
      service.preview({ semesterId, contracts: [line, line] }),
    ).rejects.toThrow(BadRequestException);
    expect(
      (
        await service.preview({
          semesterId,
          contracts: [line, { ...line, parallel: 'L2' }],
        })
      ).totalAmountClp,
    ).toBe('1279200');
  });
  it('rechaza contratos de otro docente al calcular o reemplazar', async () => {
    await expect(
      service.preview({
        semesterId,
        teacherId,
        contracts: [{ ...line, id: contractId }],
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.removeOmitted(tx, teacherId, semesterId, [
        { ...line, id: contractId },
      ]),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.hourlyTeachingContract.deleteMany).not.toHaveBeenCalled();
  });
  it('conserva la tarifa histórica cuando cambia el catálogo', async () => {
    prisma.hourlyTeachingContract.findMany.mockResolvedValue([
      {
        id: contractId,
        payRateId: rateId,
        hourlyRateClp: new Prisma.Decimal(50000),
      },
    ]);
    const result = await service.preview({
      semesterId,
      teacherId,
      contracts: [{ ...line, id: contractId }],
    });
    expect(result.totalAmountClp).toBe('615000');
    await service.sync(tx, teacherId, semesterId, [
      { ...line, id: contractId },
    ]);
    expect(prisma.hourlyTeachingContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hourlyRateClp: new Prisma.Decimal(50000),
        }),
      }),
    );
  });
  it('crea un contrato con NRC vinculado y copia la tarifa vigente', async () => {
    await service.sync(tx, teacherId, semesterId, [line]);
    expect(prisma.hourlyTeachingContract.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        teachingAssignmentId: 'assignment',
        semesterId,
        directHours: 3,
        hourlyRateClp: rate.hourlyRateClp,
      }),
    });
  });
  it('rechaza una asignatura no vinculada al docente', async () => {
    await expect(
      service.sync(tx, teacherId, semesterId, [{ ...line, nrc: 'other' }]),
    ).rejects.toThrow(BadRequestException);
  });
  it('elimina solo los contratos omitidos del semestre activo de este docente', async () => {
    await service.removeOmitted(tx, teacherId, semesterId, []);
    expect(prisma.hourlyTeachingContract.deleteMany).toHaveBeenCalledWith({
      where: {
        semesterId,
        teachingAssignment: { teacherId },
        id: { notIn: [] },
      },
    });
  });
  it('configura tarifas sin sobrescribir contratos y valida combinaciones', async () => {
    const input: HourlyPayRateDto = {
      semesterId,
      category: 'NEW',
      academicDegree: 'PROFESSIONAL',
      certification: 'NONE',
      hourlyRateClp: 52000,
    };
    await controller.setRate(input);
    expect(prisma.hourlyPayRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { hourlyRateClp: 52000 } }),
    );
    expect(prisma.hourlyTeachingContract.update).not.toHaveBeenCalled();
    await expect(
      service.setRate({ ...input, certification: 'LEVEL_3' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.setRate({ ...input, category: 'DIVING_PRINCIPAL' }),
    ).rejects.toThrow(BadRequestException);
  });
  it('entrega estados vacíos y errores de docentes inexistentes', async () => {
    prisma.academicSemester.findFirst.mockResolvedValue(null);
    expect(await service.catalog()).toEqual({ semester: null, rates: [] });
    expect(await service.teacherContracts(teacherId)).toEqual({
      semesterId: null,
      contracts: [],
    });
    prisma.teacher.findUnique.mockResolvedValue(null);
    await expect(service.teacherContracts(teacherId)).rejects.toThrow(
      NotFoundException,
    );
  });
  it('valida entradas anidadas, horas, fechas y tarifas', async () => {
    expect(
      await validate(
        plainToInstance(HourlyPaymentPreviewDto, {
          semesterId,
          contracts: [line],
        }),
      ),
    ).toHaveLength(0);
    for (const override of [
      { directHours: -1 },
      { directHours: 169 },
      { startsOn: '2026-02-30' },
      { payRateId: 'invalid' },
      { component: 'invalid' },
    ]) {
      expect(
        (
          await validate(
            plainToInstance(HourlyPaymentPreviewDto, {
              semesterId,
              contracts: [{ ...line, ...override }],
            }),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
    expect(
      (
        await validate(
          plainToInstance(HourlyPayRateDto, { ...rate, hourlyRateClp: 0 }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('reserva las escrituras a secretaría y administración', () => {
    const context = (roles: string[], handler: () => unknown) =>
      ({
        getType: () => 'http',
        getClass: () => HourlyPaymentsController,
        getHandler: () => handler,
        switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
      }) as unknown as ExecutionContext;
    const guard = new RolesGuard(new Reflector());
    expect(() =>
      guard.canActivate(
        context(['ACADEMIC_PROCESS_ANALYST'], controller.setRate),
      ),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(context(['ACADEMIC_SECRETARY'], controller.preview)),
    ).toBe(true);
    expect(
      guard.canActivate(context(['SYSTEM_ADMIN'], controller.setRate)),
    ).toBe(true);
  });
});
