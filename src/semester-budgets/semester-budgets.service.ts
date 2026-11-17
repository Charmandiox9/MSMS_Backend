import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSemesterBudgetDto } from './semester-budgets.dto';
import { SemesterBudgetCategoryCode } from '@prisma/client';

const inferredCategoryCode = (
  name: string,
): SemesterBudgetCategoryCode | undefined => {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (normalized === 'ayudantias' || normalized === 'assistantships')
    return SemesterBudgetCategoryCode.ASSISTANTSHIPS;
  if (normalized === 'profesores por hora' || normalized === 'hourly teachers')
    return SemesterBudgetCategoryCode.HOURLY_TEACHERS;
  return undefined;
};

const BUDGET_INCLUDE = {
  allocations: { orderBy: { name: 'asc' as const } },
  thresholds: {
    orderBy: { percentage: 'asc' as const },
    include: { recipientRoles: { include: { role: true } } },
  },
};

@Injectable()
export class SemesterBudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(semesterId: string) {
    const semester = await this.prisma.academicSemester.findUnique({
      where: { id: semesterId },
      include: { budget: { include: BUDGET_INCLUDE } },
    });
    if (!semester) throw new NotFoundException('Semestre no encontrado');
    const roles = await this.prisma.role.findMany({ orderBy: { name: 'asc' } });
    const budget = semester.budget;
    return {
      semesterId,
      semesterName: semester.name,
      totalAmountClp: budget?.totalAmountClp.toNumber() ?? 0,
      allocations:
        budget?.allocations.map((item) => ({
          ...item,
          amountClp: item.amountClp.toNumber(),
        })) ?? [],
      thresholds:
        budget?.thresholds.map((item) => ({
          id: item.id,
          percentage: item.percentage,
          roleCodes: item.recipientRoles.map(({ role }) => role.code),
        })) ?? [],
      roleOptions: roles.map(({ code, name }) => ({ code, name })),
    };
  }

  async update(semesterId: string, dto: UpdateSemesterBudgetDto) {
    const allocations = dto.allocations.map((item) => ({
      ...item,
      code: item.code ?? inferredCategoryCode(item.name),
    }));
    const names = allocations.map(({ name }) =>
      name.trim().toLocaleLowerCase(),
    );
    const categoryCodes = allocations.flatMap(({ code }) =>
      code ? [code] : [],
    );
    const percentages = dto.thresholds.map(({ percentage }) => percentage);
    if (new Set(names).size !== names.length)
      throw new BadRequestException(
        'Los nombres de categorías deben ser únicos',
      );
    if (new Set(categoryCodes).size !== categoryCodes.length)
      throw new BadRequestException(
        'Cada categoría presupuestaria solo puede aparecer una vez',
      );
    if (new Set(percentages).size !== percentages.length)
      throw new BadRequestException('Los umbrales deben ser únicos');
    const allocated = dto.allocations.reduce(
      (sum, item) => sum + item.amountClp,
      0,
    );
    if (allocated > dto.totalAmountClp)
      throw new BadRequestException(
        'Las asignaciones superan el presupuesto total',
      );

    const roleCodes = [
      ...new Set(dto.thresholds.flatMap(({ roleCodes: codes }) => codes)),
    ];
    const [semester, roles] = await Promise.all([
      this.prisma.academicSemester.findUnique({
        where: { id: semesterId },
        select: { id: true },
      }),
      this.prisma.role.findMany({
        where: { code: { in: roleCodes } },
        select: { id: true, code: true },
      }),
    ]);
    if (!semester) throw new NotFoundException('Semestre no encontrado');
    if (roles.length !== roleCodes.length)
      throw new BadRequestException('Uno o más roles no existen');
    const roleIds = new Map(roles.map((role) => [role.code, role.id]));

    await this.prisma.$transaction(async (tx) => {
      const budget = await tx.semesterBudget.upsert({
        where: { semesterId },
        create: {
          semesterId,
          totalAmountClp: new Prisma.Decimal(dto.totalAmountClp),
        },
        update: { totalAmountClp: new Prisma.Decimal(dto.totalAmountClp) },
      });
      await tx.semesterBudgetAllocation.deleteMany({
        where: { budgetId: budget.id },
      });
      await tx.semesterBudgetThreshold.deleteMany({
        where: { budgetId: budget.id },
      });
      await tx.semesterBudgetAllocation.createMany({
        data: allocations.map(({ name, amountClp, code }) => ({
          budgetId: budget.id,
          name: name.trim(),
          amountClp: new Prisma.Decimal(amountClp),
          code,
        })),
      });
      for (const threshold of dto.thresholds) {
        await tx.semesterBudgetThreshold.create({
          data: {
            budgetId: budget.id,
            percentage: threshold.percentage,
            recipientRoles: {
              create: threshold.roleCodes.map((code) => ({
                roleId: roleIds.get(code)!,
              })),
            },
          },
        });
      }
    });
    return this.get(semesterId);
  }

  async alerts(userRoles: string[]) {
    const semesters = await this.prisma.academicSemester.findMany({
      where: { isActive: true, budget: { isNot: null } },
      include: { budget: { include: BUDGET_INCLUDE } },
    });
    return semesters.flatMap((semester) => {
      const budget = semester.budget;
      if (!budget || budget.totalAmountClp.isZero()) return [];
      const allocatedAmountClp = budget.allocations.reduce(
        (sum, item) => sum + item.amountClp.toNumber(),
        0,
      );
      const currentPercentage = Math.floor(
        (allocatedAmountClp / budget.totalAmountClp.toNumber()) * 100,
      );
      const reached = budget.thresholds.filter(
        (threshold) =>
          threshold.percentage <= currentPercentage &&
          threshold.recipientRoles.some(({ role }) =>
            userRoles.includes(role.code),
          ),
      );
      const threshold = reached.sort((a, b) => b.percentage - a.percentage)[0];
      return threshold
        ? [
            {
              semesterId: semester.id,
              semesterName: semester.name,
              totalAmountClp: budget.totalAmountClp.toNumber(),
              allocatedAmountClp,
              currentPercentage,
              thresholdPercentage: threshold.percentage,
            },
          ]
        : [];
    });
  }

  async assistantshipSummary(semesterId: string) {
    const semester = await this.prisma.academicSemester.findUnique({
      where: { id: semesterId },
      include: { budget: { include: { allocations: true } } },
    });
    if (!semester) throw new NotFoundException('Semestre no encontrado');
    const allocation = semester.budget?.allocations.find(
      (item) =>
        item.code === SemesterBudgetCategoryCode.ASSISTANTSHIPS ||
        inferredCategoryCode(item.name) ===
          SemesterBudgetCategoryCode.ASSISTANTSHIPS,
    );
    const records = await this.prisma.assistantship.findMany({
      where: { semesterId },
      select: {
        weeklyHours: true,
        tariffRateClp: true,
        startsOn: true,
        endsOn: true,
      },
    });
    const unpricedCount = records.filter(
      (record) => !record.weeklyHours || !record.tariffRateClp,
    ).length;
    const occupied = records.reduce((sum, record) => {
      if (!record.weeklyHours || !record.tariffRateClp) return sum;
      const end = record.endsOn ?? semester.endsOn;
      const days = Math.max(
        0,
        Math.floor((end.getTime() - record.startsOn.getTime()) / 86_400_000) +
          1,
      );
      const amount = record.tariffRateClp
        .mul(record.weeklyHours)
        .mul(days)
        .div(30);
      return sum.add(amount);
    }, new Prisma.Decimal(0));
    const allocatedAmountClp = allocation?.amountClp ?? new Prisma.Decimal(0);
    const occupiedAmountClp = occupied.toDecimalPlaces(
      0,
      Prisma.Decimal.ROUND_HALF_UP,
    );
    return {
      semesterId,
      semesterName: semester.name,
      allocatedAmountClp: allocatedAmountClp.toNumber(),
      occupiedAmountClp: occupiedAmountClp.toNumber(),
      percentage: allocatedAmountClp.isZero()
        ? 0
        : occupied
            .div(allocatedAmountClp)
            .mul(100)
            .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
            .toNumber(),
      assistantships: records.length,
      unpricedCount,
    };
  }
}
