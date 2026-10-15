import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ParticipantInputDto,
  ProjectInputDto,
  ResearchInputDto,
  RepositoryInputDto,
  RepositoryQueryDto,
  ResearchOutputInputDto,
  ResearchOutputQueryDto,
  UpdateProjectDto,
  UpdateResearchDto,
  UpdateResearchOutputDto,
} from './repository.dto';

const projectInclude = {
  participants: { orderBy: { id: 'asc' as const } },
  research: { select: { id: true, title: true } },
  _count: { select: { outputs: true } },
} satisfies Prisma.ProjectInclude;
const researchInclude = {
  participants: { orderBy: { id: 'asc' as const } },
  project: { select: { id: true, title: true, code: true } },
  _count: { select: { outputs: true } },
} satisfies Prisma.ResearchInclude;
const outputInclude = {
  research: { select: { id: true, title: true, code: true } },
  authors: { orderBy: { position: 'asc' as const } },
  projects: { include: { project: { select: { id: true, title: true, code: true } } } },
} satisfies Prisma.ResearchOutputInclude;
const date = (value?: string | null) =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;
const amountFields = [
  'totalAmount',
  'vraContribution',
  'vridtContribution',
  'recoveryAmount',
  'facultyContribution',
  'depreciationAmount',
  'profitabilityAmount',
] as const;
const textFilter = (search: string) => ({
  contains: search.replace(/[\\%_]/g, '\\$&'),
  mode: 'insensitive' as const,
});

@Injectable()
export class RepositoryService {
  constructor(private readonly prisma: PrismaService) {}

  async projects(query: RepositoryQueryDto) {
    const { page, pageSize, search } = query;
    const sortBy = query.sortBy ?? 'reportingYear';
    if (!['title', 'reportingYear', 'startsOn', 'totalAmount', 'status', 'createdAt'].includes(sortBy))
      throw new BadRequestException('El criterio de orden no corresponde a proyectos');
    const sortOrder = query.sortOrder ?? 'desc';
    const where: Prisma.ProjectWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.reportingYear ? { reportingYear: query.reportingYear } : {}),
      ...(search
        ? {
            OR: [
              { title: textFilter(search) },
              { code: textFilter(search) },
              { academicUnit: textFilter(search) },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        include: projectInclude,
        orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async researchList(query: RepositoryQueryDto) {
    if (query.reportingYear || query.status)
      throw new BadRequestException(
        'Los filtros de año y estado corresponden a proyectos',
      );
    const { page, pageSize, search } = query;
    const sortBy = query.sortBy ?? 'createdAt';
    if (!['title', 'startsOn', 'createdAt'].includes(sortBy))
      throw new BadRequestException(
        'El criterio de orden no corresponde a investigaciones',
      );
    const sortOrder = query.sortOrder ?? 'desc';
    const where: Prisma.ResearchWhereInput = search
      ? {
          OR: [
            { title: textFilter(search) },
            { code: textFilter(search) },
            { academicUnit: textFilter(search) },
            { researchArea: textFilter(search) },
          ],
        }
      : {};
    const [total, items] = await this.prisma.$transaction([
      this.prisma.research.count({ where }),
      this.prisma.research.findMany({
        where,
        include: researchInclude,
        orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async researchOutputs(query: ResearchOutputQueryDto) {
    const { page, pageSize, search } = query;
    const sortBy = query.sortBy ?? 'reportingYear';
    if (!['title', 'reportingYear', 'publicationDate', 'createdAt', 'kind'].includes(sortBy))
      throw new BadRequestException('El criterio de orden no corresponde a resultados académicos');
    const where: Prisma.ResearchOutputWhereInput = {
      ...(query.researchId ? { researchId: query.researchId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.reportingYear ? { reportingYear: query.reportingYear } : {}),
      ...(search ? { OR: [{ title: textFilter(search) }, { doi: textFilter(search) }, { journal: textFilter(search) }] } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.researchOutput.count({ where }),
      this.prisma.researchOutput.findMany({
        where, include: outputInclude,
        orderBy: [{ [sortBy]: query.sortOrder ?? 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async researchOutput(id: string) {
    const row = await this.prisma.researchOutput.findUnique({ where: { id }, include: outputInclude });
    if (!row) throw new NotFoundException('Resultado académico no encontrado');
    return row;
  }

  private outputData(input: ResearchOutputInputDto) {
    if (input.authors?.some((author) => author.teacherId && author.studentId))
      throw new BadRequestException('Una autoría no puede vincular a un profesor y estudiante simultáneamente');
    if (input.authors && new Set(input.authors.map(({ position }) => position)).size !== input.authors.length)
      throw new BadRequestException('Las posiciones de autoría deben ser únicas');
    return {
      researchId: input.researchId,
      kind: input.kind,
      reportingYear: input.reportingYear,
      title: input.title,
      doi: input.doi ?? null,
      journal: input.journal ?? null,
      issn: input.issn ?? null,
      isbn: input.isbn ?? null,
      quartile: input.quartile ?? null,
      fiveYearImpactFactor: input.fiveYearImpactFactor == null ? null : new Prisma.Decimal(input.fiveYearImpactFactor),
      publicationDate: date(input.publicationDate),
      indexation: input.indexation ?? null,
      publisher: input.publisher ?? null,
      publicationPlace: input.publicationPlace ?? null,
      studentParticipation: input.studentParticipation ?? null,
      internationalParticipation: input.internationalParticipation ?? null,
      intellectualPropertyType: input.intellectualPropertyType ?? null,
      phase: input.phase ?? null,
      phaseDate: date(input.phaseDate),
      notes: input.notes ?? null,
    } satisfies Prisma.ResearchOutputUncheckedCreateInput;
  }

  private async validateOutputRelations(tx: Prisma.TransactionClient, input: ResearchOutputInputDto) {
    if (!(await tx.research.findUnique({ where: { id: input.researchId }, select: { id: true } })))
      throw new BadRequestException('La investigación seleccionada no existe');
    const projectIds = [...new Set(input.projectIds ?? [])];
    const teacherIds = [...new Set((input.authors ?? []).flatMap(({ teacherId }) => teacherId ? [teacherId] : []))];
    const studentIds = [...new Set((input.authors ?? []).flatMap(({ studentId }) => studentId ? [studentId] : []))];
    const [projects, teachers, students] = await Promise.all([
      projectIds.length ? tx.project.findMany({ where: { id: { in: projectIds } }, select: { id: true } }) : [],
      teacherIds.length ? tx.teacher.findMany({ where: { id: { in: teacherIds } }, select: { id: true } }) : [],
      studentIds.length ? tx.student.findMany({ where: { id: { in: studentIds } }, select: { id: true } }) : [],
    ]);
    if (projects.length !== projectIds.length) throw new BadRequestException('Uno o más proyectos seleccionados no existen');
    if (teachers.length !== teacherIds.length) throw new BadRequestException('Uno o más profesores seleccionados no existen');
    if (students.length !== studentIds.length) throw new BadRequestException('Uno o más estudiantes seleccionados no existen');
    return projectIds;
  }

  createResearchOutput(input: ResearchOutputInputDto) {
    const data = this.outputData(input);
    return this.mutate(async (tx) => {
      const projectIds = await this.validateOutputRelations(tx, input);
      return tx.researchOutput.create({
        data: {
          ...data,
          authors: { create: (input.authors ?? []).map((author) => ({ ...author, teacherId: author.teacherId ?? null, studentId: author.studentId ?? null, affiliation: author.affiliation ?? null, isStudent: author.isStudent ?? null })) },
          projects: { create: projectIds.map((projectId) => ({ projectId })) },
        }, include: outputInclude,
      });
    });
  }

  updateResearchOutput(id: string, input: UpdateResearchOutputDto) {
    const data = this.outputData(input);
    return this.mutate(async (tx) => {
      this.checkVersion(await tx.researchOutput.findUnique({ where: { id }, select: { updatedAt: true } }), input.expectedUpdatedAt);
      const projectIds = await this.validateOutputRelations(tx, input);
      return tx.researchOutput.update({
        where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
        data: {
          ...data,
          ...(input.authors === undefined ? {} : { authors: { deleteMany: {}, create: input.authors.map((author) => ({ ...author, teacherId: author.teacherId ?? null, studentId: author.studentId ?? null, affiliation: author.affiliation ?? null, isStudent: author.isStudent ?? null })) } }),
          ...(input.projectIds === undefined ? {} : { projects: { deleteMany: {}, create: projectIds.map((projectId) => ({ projectId })) } }),
        }, include: outputInclude,
      });
    });
  }

  deleteResearchOutput(id: string, expectedUpdatedAt: string) {
    return this.mutate(async (tx) => {
      this.checkVersion(await tx.researchOutput.findUnique({ where: { id }, select: { updatedAt: true } }), expectedUpdatedAt);
      await tx.researchOutput.delete({ where: { id, updatedAt: new Date(expectedUpdatedAt) } });
      return { success: true };
    });
  }

  async project(id: string) {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: projectInclude,
    });
    if (!row) throw new NotFoundException('Proyecto no encontrado');
    return row;
  }

  async research(id: string) {
    const row = await this.prisma.research.findUnique({
      where: { id },
      include: researchInclude,
    });
    if (!row) throw new NotFoundException('Investigación no encontrada');
    return row;
  }

  private validateDates(
    input: RepositoryInputDto,
    otherDates: (string | null | undefined)[] = [],
  ) {
    const dates = [input.endsOn, ...otherDates];
    if (
      input.startsOn &&
      dates.some((value) => value && value < input.startsOn!)
    )
      throw new BadRequestException(
        'Las fechas de término y cierre no pueden preceder al inicio',
      );
  }

  private projectData(input: ProjectInputDto) {
    this.validateDates(input, [input.revisedEndsOn, input.closedOn]);
    if (
      amountFields.some(
        (field) => input[field] !== undefined && input[field] !== null,
      ) &&
      !input.currency
    )
      throw new BadRequestException('Indica la moneda cuando registres montos');
    return {
      title: input.title,
      academicUnit: input.academicUnit,
      code: input.code ?? null,
      reportingYear: input.reportingYear,
      status: input.status,
      faculty: input.faculty ?? null,
      resolution: input.resolution ?? null,
      classification: input.classification ?? null,
      fundingSource: input.fundingSource ?? null,
      program: input.program ?? null,
      competition: input.competition ?? null,
      applicationArea: input.applicationArea ?? null,
      participationScope: input.participationScope ?? null,
      officialized: input.officialized ?? null,
      startsOn: date(input.startsOn),
      endsOn: date(input.endsOn),
      revisedEndsOn: date(input.revisedEndsOn),
      closedOn: date(input.closedOn),
      currency: input.currency ?? null,
      folderUrl: input.folderUrl ?? null,
      notes: input.notes ?? null,
      totalAmount:
        input.totalAmount === undefined || input.totalAmount === null
          ? null
          : new Prisma.Decimal(input.totalAmount),
      vraContribution:
        input.vraContribution === undefined || input.vraContribution === null
          ? null
          : new Prisma.Decimal(input.vraContribution),
      vridtContribution:
        input.vridtContribution === undefined ||
        input.vridtContribution === null
          ? null
          : new Prisma.Decimal(input.vridtContribution),
      recoveryAmount:
        input.recoveryAmount === undefined || input.recoveryAmount === null
          ? null
          : new Prisma.Decimal(input.recoveryAmount),
      facultyContribution:
        input.facultyContribution === undefined ||
        input.facultyContribution === null
          ? null
          : new Prisma.Decimal(input.facultyContribution),
      depreciationAmount:
        input.depreciationAmount === undefined ||
        input.depreciationAmount === null
          ? null
          : new Prisma.Decimal(input.depreciationAmount),
      profitabilityAmount:
        input.profitabilityAmount === undefined ||
        input.profitabilityAmount === null
          ? null
          : new Prisma.Decimal(input.profitabilityAmount),
    } satisfies Prisma.ProjectUncheckedCreateInput;
  }

  private researchData(input: ResearchInputDto) {
    this.validateDates(input);
    if (input.participants?.some((item) => item.contactEmail || item.gender))
      throw new BadRequestException(
        'Correo y género de participantes corresponden al registro de proyectos',
      );
    return {
      title: input.title,
      academicUnit: input.academicUnit,
      code: input.code ?? null,
      description: input.description ?? null,
      researchArea: input.researchArea ?? null,
      projectId: input.projectId ?? null,
      startsOn: date(input.startsOn),
      endsOn: date(input.endsOn),
    } satisfies Prisma.ResearchUncheckedCreateInput;
  }

  private checkVersion(row: { updatedAt: Date } | null, expected: string) {
    if (!row) throw new NotFoundException('Registro no encontrado');
    if (row.updatedAt.toISOString() !== new Date(expected).toISOString())
      throw new ConflictException(
        'El registro cambió. Recarga antes de guardar o eliminar',
      );
  }

  private async participants(
    tx: Prisma.TransactionClient,
    input: ParticipantInputDto[],
  ) {
    const ids = [
      ...new Set(
        input.flatMap((item) => (item.teacherId ? [item.teacherId] : [])),
      ),
    ];
    const teachers = ids.length
      ? await tx.teacher.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    if (teachers.length !== ids.length)
      throw new BadRequestException('Uno o más profesores no existen');
    const resolved = input.map((item) => ({
      ...item,
      name: item.teacherId
        ? teachers.find((teacher) => teacher.id === item.teacherId)!.name
        : item.name,
      teacherId: item.teacherId ?? null,
    }));
    const keys = resolved.map((item) => `${item.name.trim()}\0${item.role}`);
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException('No repitas el mismo participante y rol');
    return resolved;
  }

  private async mutate<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002')
          throw new ConflictException(
            'El código, DOI, vínculo con proyecto o participante ya está registrado',
          );
        if (error.code === 'P2003')
          throw new ConflictException(
            'El registro tiene vínculos que impiden esta operación',
          );
        if (error.code === 'P2025')
          throw new NotFoundException('Registro no encontrado');
        if (error.code === 'P2034')
          throw new ConflictException(
            'Otro usuario modificó los datos. Recarga e intenta nuevamente',
          );
        throw new BadRequestException('No fue posible guardar el registro');
      }
      throw error;
    }
  }

  createProject(input: ProjectInputDto) {
    const data = this.projectData(input);
    return this.mutate(async (tx) => {
      const participants = await this.participants(
        tx,
        input.participants ?? [],
      );
      return tx.project.create({
        data: { ...data, participants: { create: participants } },
        include: projectInclude,
      });
    });
  }

  updateProject(id: string, input: UpdateProjectDto) {
    const data = this.projectData(input);
    return this.mutate(async (tx) => {
      this.checkVersion(
        await tx.project.findUnique({
          where: { id },
          select: { updatedAt: true },
        }),
        input.expectedUpdatedAt,
      );
      const participants =
        input.participants === undefined
          ? undefined
          : await this.participants(tx, input.participants);
      return tx.project.update({
        where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
        data: {
          ...data,
          ...(participants
            ? { participants: { deleteMany: {}, create: participants } }
            : {}),
        },
        include: projectInclude,
      });
    });
  }

  deleteProject(id: string, expectedUpdatedAt: string) {
    return this.mutate(async (tx) => {
      const row = await tx.project.findUnique({
        where: { id },
        include: projectInclude,
      });
      this.checkVersion(row, expectedUpdatedAt);
      if (row!.research || row!._count.outputs)
        throw new ConflictException(
          'Desvincula la investigación y los resultados antes de eliminar el proyecto',
        );
      await tx.project.delete({
        where: { id, updatedAt: new Date(expectedUpdatedAt) },
      });
      return { success: true };
    });
  }

  private async validateProject(
    tx: Prisma.TransactionClient,
    id?: string | null,
  ) {
    if (
      id &&
      !(await tx.project.findUnique({ where: { id }, select: { id: true } }))
    )
      throw new BadRequestException('El proyecto seleccionado no existe');
  }

  createResearch(input: ResearchInputDto) {
    const data = this.researchData(input);
    return this.mutate(async (tx) => {
      await this.validateProject(tx, input.projectId);
      const participants = await this.participants(
        tx,
        input.participants ?? [],
      );
      return tx.research.create({
        data: {
          ...data,
          participants: {
            create: participants.map(({ name, role, teacherId }) => ({
              name,
              role,
              teacherId,
            })),
          },
        },
        include: researchInclude,
      });
    });
  }

  updateResearch(id: string, input: UpdateResearchDto) {
    const data = this.researchData(input);
    return this.mutate(async (tx) => {
      this.checkVersion(
        await tx.research.findUnique({
          where: { id },
          select: { updatedAt: true },
        }),
        input.expectedUpdatedAt,
      );
      await this.validateProject(tx, input.projectId);
      const participants =
        input.participants === undefined
          ? undefined
          : await this.participants(tx, input.participants);
      return tx.research.update({
        where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
        data: {
          ...data,
          ...(participants
            ? {
                participants: {
                  deleteMany: {},
                  create: participants.map(({ name, role, teacherId }) => ({
                    name,
                    role,
                    teacherId,
                  })),
                },
              }
            : {}),
        },
        include: researchInclude,
      });
    });
  }

  deleteResearch(id: string, expectedUpdatedAt: string) {
    return this.mutate(async (tx) => {
      const row = await tx.research.findUnique({
        where: { id },
        include: researchInclude,
      });
      this.checkVersion(row, expectedUpdatedAt);
      if (row!._count.outputs)
        throw new ConflictException(
          'Desvincula los resultados antes de eliminar la investigación',
        );
      await tx.research.delete({
        where: { id, updatedAt: new Date(expectedUpdatedAt) },
      });
      return { success: true };
    });
  }
}
