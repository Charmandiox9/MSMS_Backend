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
});
