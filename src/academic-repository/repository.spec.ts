import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RepositoryService } from './repository.service';
import {
  ProjectsController,
  ResearchController,
  ResearchOutputsController,
} from './repository.controller';
import {
  ProjectInputDto,
  RepositoryQueryDto,
  ResearchInputDto,
  UpdateProjectDto,
  ResearchOutputInputDto,
} from './repository.dto';

const id = '22222222-2222-4222-8222-222222222222';
const version = '2026-10-14T12:00:00.000Z';
const project = {
  title: 'Ecosistemas costeros',
  academicUnit: 'Ciencias del Mar',
  reportingYear: 2026,
  status: 'REGISTERED' as const,
};
const row = {
  id,
  ...project,
  updatedAt: new Date(version),
  participants: [],
  research: null,
  _count: { outputs: 0 },
};

describe('CRUD del repositorio académico', () => {
  const delegate = () => ({
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  });
  const prisma = {
    project: delegate(),
    research: delegate(),
    researchOutput: delegate(),
    teacher: delegate(),
    student: delegate(),
    $transaction: jest.fn(),
  };
  let service: RepositoryService;
  let projects: ProjectsController;
  let research: ResearchController;
  let outputs: ResearchOutputsController;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProjectsController, ResearchController, ResearchOutputsController],
      providers: [
        RepositoryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(RepositoryService);
    projects = module.get(ProjectsController);
    research = module.get(ResearchController);
    outputs = module.get(ResearchOutputsController);
  });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((input: unknown) =>
      typeof input === 'function'
        ? input(prisma)
        : Promise.all(input as Promise<unknown>[]),
    );
    prisma.project.findUnique.mockResolvedValue(row);
    prisma.research.findUnique.mockResolvedValue({ ...row, project: null });
    prisma.researchOutput.findUnique.mockResolvedValue({ id, updatedAt: new Date(version) });
    prisma.researchOutput.count.mockResolvedValue(1);
    prisma.researchOutput.findMany.mockResolvedValue([]);
    prisma.researchOutput.create.mockResolvedValue({ id, updatedAt: new Date(version) });
    prisma.researchOutput.update.mockResolvedValue({ id, updatedAt: new Date(version) });
    prisma.researchOutput.delete.mockResolvedValue({ id });
    prisma.project.findMany.mockResolvedValue([]);
    prisma.teacher.findMany.mockResolvedValue([]);
    prisma.student.findMany.mockResolvedValue([]);
    prisma.project.create.mockResolvedValue(row);
    prisma.project.update.mockResolvedValue(row);
    prisma.research.create.mockResolvedValue({ ...row, project: null });
    prisma.research.update.mockResolvedValue({ ...row, project: null });
    prisma.teacher.findMany.mockResolvedValue([]);
  });

  it('pagina opciones con el vínculo de investigación sin cargar participantes ni metadatos', async () => {
    prisma.project.count.mockResolvedValue(150);
    prisma.project.findMany.mockResolvedValue([
      { id, title: 'Proyecto', code: null, research: { id: 'research-1' } },
    ]);
    const result = await service.projectOptions({ page: 2, pageSize: 100 });
    expect(result).toMatchObject({
      total: 150,
      totalPages: 2,
      items: [{ id, title: 'Proyecto', researchId: 'research-1' }],
    });
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        title: true,
        code: true,
        research: { select: { id: true } },
      },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      skip: 100,
      take: 100,
    });
  });

  it('registra proyectos con importes desconocidos en NULL y cero explícito en Decimal', async () => {
    await projects.create(project);
    expect(prisma.project.create.mock.calls[0][0].data).toMatchObject({
      totalAmount: null,
      currency: null,
      startsOn: null,
    });
    await projects.create({
      ...project,
      totalAmount: '0',
      currency: 'CLP',
      startsOn: '2026-10-01',
    });
    expect(
      prisma.project.create.mock.calls[1][0].data.totalAmount.toString(),
    ).toBe('0');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('rechaza fechas invertidas, importes sin moneda y cierre anterior al inicio', () => {
    expect(() =>
      service.createProject({
        ...project,
        startsOn: '2026-10-10',
        endsOn: '2026-10-01',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.createProject({ ...project, totalAmount: '1200.25' }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.createProject({
        ...project,
        startsOn: '2026-10-10',
        closedOn: '2026-10-01',
      }),
    ).toThrow(BadRequestException);
    expect(prisma.project.create).not.toHaveBeenCalled();
  });
  it('resuelve docentes globales sin aceptar nombres falsificados y valida duplicados de participantes', async () => {
    prisma.teacher.findMany.mockResolvedValue([
      { id, name: 'Nombre del padrón' },
    ]);
    await service.createProject({
      ...project,
      participants: [
        { teacherId: id, name: 'Nombre alterado', role: 'Director' },
      ],
    });
    expect(
      prisma.project.create.mock.calls[0][0].data.participants.create[0].name,
    ).toBe('Nombre del padrón');
    await expect(
      service.createProject({
        ...project,
        participants: [
          { name: 'Persona', role: 'Director' },
          { name: 'Persona', role: 'Director' },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    prisma.teacher.findMany.mockResolvedValue([]);
    await expect(
      service.createProject({
        ...project,
        participants: [{ teacherId: id, name: 'Persona', role: 'Director' }],
      }),
    ).rejects.toThrow(BadRequestException);
  });
  it('exige una versión vigente y reemplaza participantes explícitamente; omitirlos conserva el equipo', async () => {
    await expect(
      projects.update(id, {
        ...project,
        expectedUpdatedAt: '2026-10-13T12:00:00.000Z',
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.project.update).not.toHaveBeenCalled();
    await projects.update(id, { ...project, expectedUpdatedAt: version });
    expect(
      prisma.project.update.mock.calls[0][0].data.participants,
    ).toBeUndefined();
    await projects.update(id, {
      ...project,
      expectedUpdatedAt: version,
      participants: [],
    });
    expect(prisma.project.update.mock.calls[1][0].data.participants).toEqual({
      deleteMany: {},
      create: [],
    });
  });
  it('permite investigar sin proyecto y rechaza vínculos inexistentes', async () => {
    await research.create({
      title: 'Actividad científica',
      academicUnit: 'Unidad',
    });
    expect(prisma.research.create.mock.calls[0][0].data.projectId).toBeNull();
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(
      research.create({
        title: 'Actividad científica',
        academicUnit: 'Unidad',
        projectId: id,
      }),
    ).rejects.toThrow(BadRequestException);
  });
  it('no descarta silenciosamente metadatos de participantes no soportados en investigaciones', () => {
    expect(() =>
      service.createResearch({
        title: 'Actividad',
        academicUnit: 'Unidad',
        participants: [
          {
            name: 'Persona',
            role: 'Director',
            contactEmail: 'contact@example.test',
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });
  it('traduce conflictos de unicidad, relaciones y concurrencia sin revelar errores de base', async () => {
    for (const code of ['P2002', 'P2003', 'P2034']) {
      prisma.research.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Dato reservado', {
          code,
          clientVersion: 'test',
        }),
      );
      await expect(
        service.createResearch({ title: 'Actividad', academicUnit: 'Unidad' }),
      ).rejects.toThrow(ConflictException);
    }
  });
  it('protege vínculos al eliminar y admite eliminar registros sin dependencias', async () => {
    prisma.project.findUnique.mockResolvedValue({
      ...row,
      research: { id: 'research', title: 'Vinculada' },
    });
    await expect(
      projects.remove(id, { expectedUpdatedAt: version }),
    ).rejects.toThrow(ConflictException);
    prisma.project.findUnique.mockResolvedValue({
      ...row,
      _count: { outputs: 1 },
    });
    await expect(
      projects.remove(id, { expectedUpdatedAt: version }),
    ).rejects.toThrow(ConflictException);
    prisma.project.findUnique.mockResolvedValue(row);
    await expect(
      projects.remove(id, { expectedUpdatedAt: version }),
    ).resolves.toEqual({ success: true });
    prisma.research.findUnique.mockResolvedValue({
      ...row,
      _count: { outputs: 1 },
    });
    await expect(
      research.remove(id, { expectedUpdatedAt: version }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.research.delete).not.toHaveBeenCalled();
  });
  it('devuelve detalle o 404 sin exponer errores de Prisma', async () => {
    await expect(projects.get(id)).resolves.toEqual(row);
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(projects.get(id)).rejects.toThrow(NotFoundException);
    prisma.research.findUnique.mockResolvedValue(null);
    await expect(research.get(id)).rejects.toThrow(NotFoundException);
  });
  it('crea resultados enlazados a investigación, valida relaciones y conserva vínculos opcionales en edición', async () => {
    const input = { researchId: id, kind: 'ARTICLE' as const, reportingYear: 2026, title: 'Artículo científico', authors: [{ name: 'Autora', position: 1 }] };
    prisma.research.findUnique.mockResolvedValue({ id });
    await outputs.create(input);
    expect(prisma.researchOutput.create.mock.calls[0][0].data).toMatchObject({
      researchId: id, title: 'Artículo científico', authors: { create: [{ name: 'Autora', position: 1, teacherId: null, studentId: null, affiliation: null, isStudent: null }] },
    });
    await outputs.update(id, { ...input, authors: undefined, expectedUpdatedAt: version });
    expect(prisma.researchOutput.update.mock.calls[0][0].data.authors).toBeUndefined();
    prisma.research.findUnique.mockResolvedValue(null);
    await expect(outputs.create(input)).rejects.toThrow(BadRequestException);
  });
  it('lista resultados asociados con filtros, orden y paginación, y elimina con versión vigente', async () => {
    await outputs.list(plainToInstance(RepositoryQueryDto, { page: 2, pageSize: 10, sortBy: 'reportingYear', sortOrder: 'asc' }));
    expect(prisma.researchOutput.findMany.mock.calls[0][0]).toMatchObject({
      where: {}, skip: 10, take: 10,
      orderBy: [{ reportingYear: 'asc' }, { id: 'asc' }],
    });
    await outputs.remove(id, { expectedUpdatedAt: version });
    expect(prisma.researchOutput.delete).toHaveBeenCalled();
  });
  it('pagina y filtra proyectos y evita filtros de estado incompatibles en investigaciones', async () => {
    prisma.project.count.mockResolvedValue(11);
    prisma.project.findMany.mockResolvedValue([row]);
    const query = plainToInstance(RepositoryQueryDto, {
      page: '2',
      search: '50%_a',
      status: 'IN_PROGRESS',
      reportingYear: '2026',
      sortBy: 'totalAmount',
      sortOrder: 'asc',
    });
    await expect(projects.list(query)).resolves.toMatchObject({
      total: 11,
      page: 2,
      totalPages: 2,
    });
    expect(prisma.project.findMany.mock.calls[0][0]).toMatchObject({
      skip: 10,
      take: 10,
      where: { status: 'IN_PROGRESS', reportingYear: 2026 },
      orderBy: [{ totalAmount: 'asc' }, { id: 'asc' }],
    });
    expect(
      prisma.project.findMany.mock.calls[0][0].where.OR[0].title.contains,
    ).toBe('50\\%\\_a');
    await expect(research.list(query)).rejects.toThrow(BadRequestException);
  });

  it.each(['SYSTEM_ADMIN', 'ACADEMIC_SECRETARY', 'ACADEMIC_PROCESS_ANALYST'])(
    'permite todos los endpoints a %s y bloquea coordinación',
    (role) => {
      const guard = new RolesGuard(new Reflector());
      for (const controller of [ProjectsController, ResearchController, ResearchOutputsController])
        for (const method of [
          'list',
          'get',
          'create',
          'update',
          'remove',
        ] as const) {
          const context = (roles: string[]) =>
            ({
              getClass: () => controller,
              getHandler: () => controller.prototype[method],
              getType: () => 'http',
              switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
            }) as unknown as ExecutionContext;
          expect(guard.canActivate(context([role]))).toBe(true);
          expect(() =>
            guard.canActivate(context(['TEACHING_SUPPORT_COORDINATOR'])),
          ).toThrow();
        }
    },
  );
});

describe('Validación de entradas del repositorio', () => {
  it.each([
    { ...project, title: ' ' },
    { ...project, participants: null },
    { ...project, folderUrl: 'https://ruta inválida' },
    { ...project, startsOn: '2026-02-31' },
    { ...project, totalAmount: '-1', currency: 'CLP' },
    { ...project, totalAmount: '1.999', currency: 'CLP' },
    { ...project, totalAmount: 1200 },
    { ...project, currency: 'pesos' },
    {
      ...project,
      participants: [{ name: 'Persona', role: '', teacherId: 'invalid' }],
    },
  ])('rechaza entradas inválidas', async (input) =>
    expect(
      (await validate(plainToInstance(ProjectInputDto, input))).length,
    ).toBeGreaterThan(0),
  );
  it('acepta NULL y cero, valida ID de proyecto y exige versión para actualizar', async () => {
    expect(
      await validate(
        plainToInstance(ProjectInputDto, {
          ...project,
          totalAmount: '0',
          currency: 'CLP',
          startsOn: null,
        }),
      ),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(ResearchInputDto, {
            title: 'Actividad',
            academicUnit: 'Unidad',
            projectId: 'invalid',
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (await validate(plainToInstance(UpdateProjectDto, project))).length,
    ).toBeGreaterThan(0);
  });
  it('valida el tipo, investigación y año de los resultados académicos', async () => {
    expect(await validate(plainToInstance(ResearchOutputInputDto, {
      researchId: id, kind: 'ARTICLE', reportingYear: 2026, title: 'Resultado',
    }))).toHaveLength(0);
    expect((await validate(plainToInstance(ResearchOutputInputDto, {
      researchId: 'invalid', kind: 'OTHER', reportingYear: 1800, title: '',
    }))).length).toBeGreaterThan(0);
  });
});
