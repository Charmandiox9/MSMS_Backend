import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HourlyPayRate, HourlyTeachingContract, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  HourlyContractDto,
  HourlyPaymentPreviewDto,
  HourlyPayRateDto,
} from './hourly-payments.dto';
import {
  calculateHourlyPayment,
  contractDate,
} from './hourly-payment-calculator';

@Injectable()
export class HourlyPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async catalog() {
    return this.prisma.$transaction(async (tx) => {
      const semester = await tx.academicSemester.findFirst({
        where: { isActive: true },
      });
      const rates = semester
        ? await tx.hourlyPayRate.findMany({
            where: { semesterId: semester.id },
            orderBy: [
              { category: 'asc' },
              { academicDegree: 'asc' },
              { certification: 'asc' },
            ],
          })
        : [];
      return { semester, rates };
    });
  }

  private async activeSemester(
    tx: Prisma.TransactionClient,
    semesterId: string,
  ) {
    const semester = await tx.academicSemester.findFirst({
      where: { isActive: true },
    });
    if (!semester)
      throw new BadRequestException('No existe un semestre activo');
    if (semester.id !== semesterId)
      throw new ConflictException(
        'El semestre activo cambió. Recarga antes de guardar',
      );
    return semester;
  }

  async setRate(input: HourlyPayRateDto) {
    const diving = input.category.startsWith('DIVING_');
    if (
      diving !== (input.academicDegree === 'NOT_APPLICABLE') ||
      (input.category !== 'EXISTING' && input.certification !== 'NONE')
    )
      throw new BadRequestException(
        'La categoría, grado y certificación de la tarifa no son compatibles',
      );
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.activeSemester(tx, input.semesterId);
          const { hourlyRateClp, ...key } = input;
          return tx.hourlyPayRate.upsert({
            where: { semesterId_category_academicDegree_certification: key },
            create: { ...key, hourlyRateClp },
            update: { hourlyRateClp },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      this.rethrow(error);
    }
  }

  private validateLines(lines: HourlyContractDto[]) {
    const keys = lines.map(
      (line) => `${line.nrc}|${line.component}|${line.parallel.trim()}`,
    );
    const ids = lines.flatMap((line) => (line.id ? [line.id] : []));
    if (new Set(keys).size !== keys.length || new Set(ids).size !== ids.length)
      throw new BadRequestException(
        'No puedes repetir un componente y paralelo del mismo NRC',
      );
  }

  private calculation(
    line: HourlyContractDto,
    rate: HourlyPayRate,
    existing?: HourlyTeachingContract,
  ) {
    return calculateHourlyPayment({
      hourlyRateClp:
        existing?.payRateId === rate.id
          ? existing.hourlyRateClp
          : rate.hourlyRateClp,
      directHours: new Prisma.Decimal(line.directHours),
      startsOn: contractDate(line.startsOn),
      endsOn: contractDate(line.endsOn),
    });
  }

  async preview(input: HourlyPaymentPreviewDto) {
    this.validateLines(input.contracts);
    return this.prisma.$transaction(async (tx) => {
      const semester = await this.activeSemester(tx, input.semesterId);
      const rates = await tx.hourlyPayRate.findMany({
        where: { semesterId: semester.id },
      });
      const existing = input.teacherId
        ? await tx.hourlyTeachingContract.findMany({
            where: {
              semesterId: semester.id,
              teachingAssignment: { teacherId: input.teacherId },
            },
          })
        : [];
      const lines = input.contracts.map((line) => {
        const rate = rates.find(({ id }) => id === line.payRateId);
        if (!rate)
          throw new BadRequestException(
            'La tarifa no pertenece al semestre activo',
          );
        const saved = existing.find(({ id }) => id === line.id);
        if (line.id && !saved)
          throw new NotFoundException(
            'El contrato no pertenece al docente y semestre indicados',
          );
        this.validatePeriod(line, semester);
        return { ...line, calculation: this.calculation(line, rate, saved) };
      });
      return {
        lines,
        totalAmountClp: lines
          .reduce(
            (sum, line) => sum.add(line.calculation.totalAmountClp),
            new Prisma.Decimal(0),
          )
          .toFixed(0),
      };
    });
  }

  private validatePeriod(
    line: HourlyContractDto,
    semester: { startsOn: Date; endsOn: Date },
  ) {
    const start = contractDate(line.startsOn),
      end = contractDate(line.endsOn);
    const firstMonth = new Date(
      Date.UTC(
        semester.startsOn.getUTCFullYear(),
        semester.startsOn.getUTCMonth(),
        1,
      ),
    );
    const lastMonth = new Date(
      Date.UTC(
        semester.endsOn.getUTCFullYear(),
        semester.endsOn.getUTCMonth() + 1,
        0,
      ),
    );
    if (end < start || start < firstMonth || end > lastMonth)
      throw new BadRequestException(
        'Las fechas deben estar ordenadas y dentro de los meses del semestre',
      );
  }

  async teacherContracts(teacherId: string) {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.teacher.findUnique({
          where: { id: teacherId },
          select: { id: true },
        }))
      )
        throw new NotFoundException('El docente no existe');
      const semester = await tx.academicSemester.findFirst({
        where: { isActive: true },
      });
      const contracts = semester
        ? await tx.hourlyTeachingContract.findMany({
            where: {
              semesterId: semester.id,
              teachingAssignment: { teacherId },
            },
            include: { teachingAssignment: { select: { nrc: true } } },
            orderBy: { createdAt: 'asc' },
          })
        : [];
      return {
        semesterId: semester?.id ?? null,
        contracts: contracts.map(({ teachingAssignment, ...contract }) => ({
          ...contract,
          nrc: teachingAssignment.nrc,
          calculation: calculateHourlyPayment(contract),
        })),
      };
    });
  }

  /** Explicit complete replacement of this teacher's active-semester contract drafts. */
  async removeOmitted(
    tx: Prisma.TransactionClient,
    teacherId: string,
    semesterId: string,
    lines: HourlyContractDto[],
  ) {
    this.validateLines(lines);
    await this.activeSemester(tx, semesterId);
    const ids = lines.flatMap((line) => (line.id ? [line.id] : []));
    const owned = await tx.hourlyTeachingContract.findMany({
      where: { semesterId, teachingAssignment: { teacherId } },
    });
    if (ids.some((id) => !owned.some((contract) => contract.id === id)))
      throw new NotFoundException(
        'El contrato no pertenece al docente y semestre indicados',
      );
    await tx.hourlyTeachingContract.deleteMany({
      where: {
        semesterId,
        teachingAssignment: { teacherId },
        id: { notIn: ids },
      },
    });
  }

  async sync(
    tx: Prisma.TransactionClient,
    teacherId: string,
    semesterId: string,
    lines: HourlyContractDto[],
  ) {
    this.validateLines(lines);
    const semester = await this.activeSemester(tx, semesterId);
    const [assignments, rates, existing] = await Promise.all([
      tx.teachingAssignment.findMany({ where: { teacherId, semesterId } }),
      tx.hourlyPayRate.findMany({ where: { semesterId } }),
      tx.hourlyTeachingContract.findMany({
        where: { semesterId, teachingAssignment: { teacherId } },
      }),
    ]);
    for (const line of lines) {
      const assignment = assignments.find(({ nrc }) => nrc === line.nrc);
      const rate = rates.find(({ id }) => id === line.payRateId);
      if (!assignment || !rate)
        throw new BadRequestException(
          'El contrato requiere un NRC vinculado al docente y una tarifa del semestre activo',
        );
      this.validatePeriod(line, semester);
      const saved = existing.find(({ id }) => id === line.id);
      if (line.id && !saved)
        throw new NotFoundException(
          'El contrato no pertenece al docente y semestre indicados',
        );
      this.calculation(line, rate, saved);
      const data = {
        semesterId,
        teachingAssignmentId: assignment.id,
        payRateId: rate.id,
        component: line.component,
        parallel: line.parallel.trim(),
        directHours: line.directHours,
        startsOn: contractDate(line.startsOn),
        endsOn: contractDate(line.endsOn),
        hourlyRateClp:
          saved?.payRateId === rate.id
            ? saved.hourlyRateClp
            : rate.hourlyRateClp,
      };
      if (line.id)
        await tx.hourlyTeachingContract.update({
          where: { id: line.id },
          data,
        });
      else await tx.hourlyTeachingContract.create({ data });
    }
  }

  private rethrow(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (['P2002', 'P2034'].includes(error.code))
        throw new ConflictException(
          'Los datos cambiaron mientras guardabas. Recarga e intenta nuevamente',
        );
      throw new BadRequestException('No fue posible guardar la tarifa');
    }
    throw error;
  }
}
