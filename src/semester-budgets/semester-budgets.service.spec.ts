import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SemesterBudgetsService } from './semester-budgets.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { UpdateSemesterBudgetDto } from './semester-budgets.dto';

describe('SemesterBudgetsService', () => {
  it('rejects allocations above the semester budget', async () => {
    const prisma = {} as PrismaService;
    const service = new SemesterBudgetsService(prisma);
    const dto: UpdateSemesterBudgetDto = {
      totalAmountClp: 100,
      allocations: [
        { name: 'Docencia', amountClp: 70 },
        { name: 'Ayudantías', amountClp: 40 },
      ],
      thresholds: [{ percentage: 80, roleCodes: ['ACADEMIC_SECRETARY'] }],
    };
    await expect(service.update('semester-id', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns the highest crossed threshold assigned to the current role', async () => {
    const prisma = {
      academicSemester: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'semester-id',
            name: '2026-2',
            budget: {
              totalAmountClp: { toNumber: () => 1000, isZero: () => false },
              allocations: [{ amountClp: { toNumber: () => 850 } }],
              thresholds: [
                {
                  percentage: 80,
                  recipientRoles: [{ role: { code: 'ACADEMIC_SECRETARY' } }],
                },
                {
                  percentage: 90,
                  recipientRoles: [{ role: { code: 'SYSTEM_ADMIN' } }],
                },
              ],
            },
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new SemesterBudgetsService(prisma);
    await expect(service.alerts(['ACADEMIC_SECRETARY'])).resolves.toEqual([
      {
        semesterId: 'semester-id',
        semesterName: '2026-2',
        totalAmountClp: 1000,
        allocatedAmountClp: 850,
        currentPercentage: 85,
        thresholdPercentage: 80,
      },
    ]);
    expect(prisma.academicSemester.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, budget: { isNot: null } },
      }),
    );
  });

  it('measures assistantship commitments against the assistantships allocation', async () => {
    const prisma = {
      academicSemester: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'semester-id',
          name: '2026-2',
          endsOn: new Date('2026-12-31'),
          budget: {
            allocations: [
              { code: 'ASSISTANTSHIPS', amountClp: new Prisma.Decimal(500000) },
            ],
          },
        }),
      },
      assistantship: {
        findMany: jest.fn().mockResolvedValue([
          {
            weeklyHours: new Prisma.Decimal(5),
            tariffRateClp: new Prisma.Decimal(20000),
            startsOn: new Date('2026-08-01'),
            endsOn: new Date('2026-08-30'),
          },
          {
            weeklyHours: new Prisma.Decimal(4),
            tariffRateClp: null,
            startsOn: new Date('2026-08-01'),
            endsOn: new Date('2026-08-30'),
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new SemesterBudgetsService(prisma);
    await expect(
      service.assistantshipSummary('semester-id'),
    ).resolves.toMatchObject({
      semesterId: 'semester-id',
      allocatedAmountClp: 500000,
      occupiedAmountClp: 100000,
      percentage: 20,
      assistantships: 2,
      unpricedCount: 1,
    });
  });

  it('separates budget allocation from monthly commitments and reconciles rounding', async () => {
    const decimal = (amount: number) => new Prisma.Decimal(amount);
    const prisma = {
      academicSemester: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'active',
          name: '2026-2',
          endsOn: new Date('2026-09-01'),
          budget: {
            totalAmountClp: decimal(26000),
            allocations: [
              {
                id: '1',
                name: 'Ayudantías',
                code: null,
                amountClp: decimal(100),
              },
              {
                id: '2',
                name: 'Docencia por hora',
                code: 'HOURLY_TEACHERS',
                amountClp: decimal(18000),
              },
              {
                id: '3',
                name: 'Materiales',
                code: null,
                amountClp: decimal(1400),
              },
            ],
          },
        }),
      },
      hourlyTeachingContract: {
        findMany: jest.fn().mockResolvedValue([
          {
            startsOn: new Date('2026-08-01'),
            endsOn: new Date('2026-08-31'),
            directHours: decimal(2),
            hourlyRateClp: decimal(10000),
          },
        ]),
      },
      assistantship: {
        findMany: jest.fn().mockResolvedValue([
          {
            startsOn: new Date('2026-08-31'),
            endsOn: null,
            weeklyHours: decimal(1),
            tariffRateClp: decimal(45),
          },
          { weeklyHours: null, tariffRateClp: null },
        ]),
      },
    };
    const service = new SemesterBudgetsService(
      prisma as unknown as PrismaService,
    );
    await expect(service.overview()).resolves.toEqual({
      state: 'ready',
      semesterName: '2026-2',
      totalClp: 26000,
      allocatedClp: 19500,
      unallocatedClp: 6500,
      estimatedClp: 20003,
      unpricedAssistantships: 1,
      allocations: [
        { id: '1', name: 'Ayudantías', allocatedClp: 100, estimatedClp: 3 },
        {
          id: '2',
          name: 'Docencia por hora',
          allocatedClp: 18000,
          estimatedClp: 20000,
        },
        { id: '3', name: 'Materiales', allocatedClp: 1400, estimatedClp: null },
      ],
      monthly: [
        {
          month: '2026-08',
          hourlyClp: 20000,
          assistantshipsClp: 2,
          accumulatedClp: 20002,
        },
        {
          month: '2026-09',
          hourlyClp: 0,
          assistantshipsClp: 1,
          accumulatedClp: 20003,
        },
      ],
    });
    expect(prisma.hourlyTeachingContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { semesterId: 'active' } }),
    );
    expect(prisma.assistantship.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { semesterId: 'active' } }),
    );
  });

  it('distinguishes no active semester from an active semester with no budget', async () => {
    const prisma = {
      academicSemester: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ name: '2026-2', budget: null }),
      },
    };
    const service = new SemesterBudgetsService(
      prisma as unknown as PrismaService,
    );
    await expect(service.overview()).resolves.toEqual({ state: 'no-semester' });
    await expect(service.overview()).resolves.toEqual({
      state: 'no-budget',
      semesterName: '2026-2',
    });
  });
});
