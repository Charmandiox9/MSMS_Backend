import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type TitulationProcess } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePiiSearch } from '../privacy/pii-policy';
import { availableTitulationDrafts } from './titulation-drafts';
import { isValidChileanRut, normalizeChileanRut } from './chilean-rut.util';
import {
  CreateTitulationDto,
  ListTitulationsDto,
  UpdateTitulationDto,
} from './titulations.dto';

type TitulationInputFields = Partial<
  Pick<
    Prisma.TitulationProcessUncheckedCreateInput,
    | 'studentName'
    | 'studentRut'
    | 'studentEmail'
    | 'studentPhone'
    | 'thesisTopic'
    | 'degree'
    | 'guideName'
    | 'coGuideName'
    | 'reviewerOneName'
    | 'reviewerTwoName'
    | 'defenseDate'
    | 'stage'
    | 'defenseAnnexesStatus'
    | 'thesisSummaryStatus'
    | 'libraryFormStatus'
    | 'actaStatus'
    | 'evaluationsStatus'
  >
>;

type TitulationWithCareer = Prisma.TitulationProcessGetPayload<{
  include: { career: { select: { id: true; code: true; name: true } } };
}>;

@Injectable()
export class TitulationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list({ page, pageSize, search, stage, careerId }: ListTitulationsDto) {
    const query = search?.trim();
    const [piiIds, careerNames] = query
      ? await Promise.all([
          this.prisma.findPiiIds('TitulationProcess', query),
          this.findCareerNames(query),
        ])
      : [[], []];
    const referencePrefix = query
      ?.match(/^TIT-\d{4}-([A-F0-9]{4,8})$/i)?.[1]
      ?.toLowerCase();
    const where: Prisma.TitulationProcessWhereInput = {
      ...(stage ? { stage } : {}),
      ...(careerId ? { careerId } : {}),
      ...(query
        ? {
            OR: [
              { id: { in: piiIds } },
              ...(careerNames.length
                ? [{ careerName: { in: careerNames } }]
                : []),
              ...(referencePrefix
                ? [{ id: { startsWith: referencePrefix } }]
                : []),
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.titulationProcess.findMany({
          where,
          select: {
            id: true,
            studentName: true,
            thesisTopic: true,
            degree: true,
            careerName: true,
            source: true,
            defenseDate: true,
            stage: true,
            defenseAnnexesStatus: true,
            thesisSummaryStatus: true,
            libraryFormStatus: true,
            actaStatus: true,
            evaluationsStatus: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.titulationProcess.count({ where }),
      ],
      { maxWait: 10_000, timeout: 30_000 },
    );

    return {
      items: items.map((item) => this.presentSummary(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private async findCareerNames(query: string): Promise<string[]> {
    const normalized = normalizePiiSearch(query);
    if (!normalized) return [];

    const names = await this.prisma.titulationProcess.groupBy({
      by: ['careerName'],
    });
    return names
      .map(({ careerName }) => careerName)
      .filter((name) => normalizePiiSearch(name).includes(normalized));
  }

  async get(id: string) {
    const process = await this.prisma.titulationProcess.findUnique({
      where: { id },
      include: { career: { select: { id: true, code: true, name: true } } },
    });
    if (!process) throw new NotFoundException('El proceso no existe');
    return this.present(process);
  }

  async create(input: CreateTitulationDto, actorId: string) {
    this.assertRut(input.studentRut);
    const career = await this.resolveCareer(input.careerId);
    const data: Prisma.TitulationProcessUncheckedCreateInput = {
      ...this.processData(input),
      studentName: input.studentName.trim(),
      studentRut: input.studentRut
        ? normalizeChileanRut(input.studentRut)
        : null,
      ...career,
      stage: 'INTAKE',
      createdById: actorId,
      updatedById: actorId,
    };

    const process = await this.prisma.titulationProcess.create({
      data,
      include: { career: { select: { id: true, code: true, name: true } } },
    });
    return this.present(process);
  }

  async update(id: string, input: UpdateTitulationDto, actorId: string) {
    if (!Object.values(input).some((value) => value !== undefined))
      throw new BadRequestException('Ingresa al menos un cambio');

    const existing = await this.prisma.titulationProcess.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('El proceso no existe');

    this.assertRut(input.studentRut);
    const career =
      input.careerId === undefined
        ? {}
        : await this.resolveCareer(input.careerId, existing.careerId);
    const data: Prisma.TitulationProcessUncheckedUpdateInput = {
      ...this.processData(input),
      ...career,
      updatedById: actorId,
    };

    const process = await this.prisma.titulationProcess.update({
      where: { id },
      data,
      include: { career: { select: { id: true, code: true, name: true } } },
    });
    return this.present(process);
  }

  private present(process: TitulationWithCareer) {
    return {
      id: process.id,
      reference: `TIT-${process.createdAt.getFullYear()}-${process.id
        .slice(0, 8)
        .toUpperCase()}`,
      studentName: process.studentName,
      studentRut: process.studentRut,
      studentEmail: process.studentEmail,
      studentPhone: process.studentPhone,
      thesisTopic: process.thesisTopic,
      degree: process.degree,
      careerName: process.careerName,
      careerId: process.careerId,
      source: process.source,
      guideName: process.guideName,
      documentDrafts: availableTitulationDrafts(process.careerName),
      coGuideName: process.coGuideName,
      reviewerOneName: process.reviewerOneName,
      reviewerTwoName: process.reviewerTwoName,
      defenseDate: process.defenseDate,
      stage: process.stage,
      defenseAnnexesStatus: process.defenseAnnexesStatus,
      thesisSummaryStatus: process.thesisSummaryStatus,
      libraryFormStatus: process.libraryFormStatus,
      actaStatus: process.actaStatus,
      evaluationsStatus: process.evaluationsStatus,
      createdAt: process.createdAt,
      updatedAt: process.updatedAt,
    };
  }

  private presentSummary<
    T extends Pick<
      TitulationProcess,
      | 'id'
      | 'createdAt'
      | 'studentName'
      | 'thesisTopic'
      | 'degree'
      | 'careerName'
      | 'source'
      | 'defenseDate'
      | 'stage'
      | 'defenseAnnexesStatus'
      | 'thesisSummaryStatus'
      | 'libraryFormStatus'
      | 'actaStatus'
      | 'evaluationsStatus'
      | 'updatedAt'
    >,
  >(process: T) {
    return {
      id: process.id,
      reference: `TIT-${process.createdAt.getFullYear()}-${process.id
        .slice(0, 8)
        .toUpperCase()}`,
      studentName: process.studentName,
      thesisTopic: process.thesisTopic,
      degree: process.degree,
      careerName: process.careerName,
      source: process.source,
      defenseDate: process.defenseDate,
      stage: process.stage,
      defenseAnnexesStatus: process.defenseAnnexesStatus,
      thesisSummaryStatus: process.thesisSummaryStatus,
      libraryFormStatus: process.libraryFormStatus,
      actaStatus: process.actaStatus,
      evaluationsStatus: process.evaluationsStatus,
      updatedAt: process.updatedAt,
    };
  }

  private assertRut(value: string | null | undefined) {
    if (value && !isValidChileanRut(value))
      throw new BadRequestException('El RUT ingresado no es válido');
  }

  private async resolveCareer(
    careerId: string,
    existingCareerId?: string | null,
  ): Promise<{ careerId: string; careerName: string }> {
    const career = await this.prisma.career.findUnique({
      where: { id: careerId },
      select: { id: true, name: true, isActive: true },
    });
    if (!career || (!career.isActive && career.id !== existingCareerId))
      throw new BadRequestException(
        'La carrera seleccionada no está disponible',
      );
    return { careerId: career.id, careerName: career.name };
  }

  private processData(
    input: CreateTitulationDto | UpdateTitulationDto,
  ): TitulationInputFields {
    const data: TitulationInputFields = {};
    if (input.studentName !== undefined)
      data.studentName = input.studentName.trim();
    if (input.studentRut !== undefined)
      data.studentRut = input.studentRut
        ? normalizeChileanRut(input.studentRut)
        : null;
    if (input.studentEmail !== undefined)
      data.studentEmail = input.studentEmail?.trim().toLowerCase() || null;
    if (input.studentPhone !== undefined)
      data.studentPhone = input.studentPhone?.trim() || null;
    if (input.thesisTopic !== undefined)
      data.thesisTopic = input.thesisTopic?.trim() || null;
    if (input.degree !== undefined) data.degree = input.degree?.trim() || null;
    if (input.guideName !== undefined)
      data.guideName = input.guideName?.trim() || null;
    if (input.coGuideName !== undefined)
      data.coGuideName = input.coGuideName?.trim() || null;
    if (input.reviewerOneName !== undefined)
      data.reviewerOneName = input.reviewerOneName?.trim() || null;
    if (input.reviewerTwoName !== undefined)
      data.reviewerTwoName = input.reviewerTwoName?.trim() || null;
    if (input.defenseDate !== undefined)
      data.defenseDate = input.defenseDate ? new Date(input.defenseDate) : null;
    if ('stage' in input && input.stage !== undefined) data.stage = input.stage;
    if (
      'defenseAnnexesStatus' in input &&
      input.defenseAnnexesStatus !== undefined
    )
      data.defenseAnnexesStatus = input.defenseAnnexesStatus;
    if (
      'thesisSummaryStatus' in input &&
      input.thesisSummaryStatus !== undefined
    )
      data.thesisSummaryStatus = input.thesisSummaryStatus;
    if ('libraryFormStatus' in input && input.libraryFormStatus !== undefined)
      data.libraryFormStatus = input.libraryFormStatus;
    if ('actaStatus' in input && input.actaStatus !== undefined)
      data.actaStatus = input.actaStatus;
    if ('evaluationsStatus' in input && input.evaluationsStatus !== undefined)
      data.evaluationsStatus = input.evaluationsStatus;
    return data;
  }
}
