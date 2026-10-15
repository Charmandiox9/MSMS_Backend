import { Reflector } from '@nestjs/core';
import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { RepositoryIdArgs } from './repository-detail.graphql';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Prisma } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ACADEMIC_REPOSITORY_ROLES } from '../academic/repository-access';
import {
  RepositoryResolver,
  RepositoryListRecordResolver,
  ResearchOutputListRecordResolver,
} from './repository.resolver';
import { RepositoryService } from './repository.service';

describe('consultas GraphQL del repositorio académico', () => {
  const service = {
    projects: jest.fn(),
    researchList: jest.fn(),
    researchOutputs: jest.fn(),
    project: jest.fn(),
    research: jest.fn(),
    researchOutput: jest.fn(),
  } as unknown as RepositoryService;
  const resolver = new RepositoryResolver(service);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['repositoryProject', 'project'],
    ['repositoryResearchDetail', 'research'],
    ['repositoryResearchOutput', 'researchOutput'],
  ] as const)(
    'propaga el error esperado de registro inexistente en %s',
    async (query, serviceMethod) => {
      const error = new NotFoundException('Registro inexistente');
      (service[serviceMethod] as jest.Mock).mockRejectedValueOnce(error);
      await expect(
        resolver[query]({ id: '22222222-2222-4222-8222-222222222222' }),
      ).rejects.toBe(error);
    },
  );

  it('valida el identificador de los detalles como UUID', async () => {
    const args = new RepositoryIdArgs();
    args.id = 'no-es-un-uuid';
    expect(await validate(args)).toHaveLength(1);
    args.id = '22222222-2222-4222-8222-222222222222';
    expect(await validate(args)).toHaveLength(0);
  });

  it.each([
    'repositoryProject',
    'repositoryResearchDetail',
    'repositoryResearchOutput',
  ] as const)(
    'autoriza los tres roles y bloquea coordinación en %s',
    (query) => {
      const guard = new RolesGuard(new Reflector());
      const context = (roles: string[]) =>
        ({
          getType: () => 'graphql',
          getClass: () => RepositoryResolver,
          getHandler: () => resolver[query],
          getArgs: () => [
            undefined,
            {},
            { req: { user: { roles } } },
            undefined,
          ],
        }) as unknown as ExecutionContext;
      for (const role of ACADEMIC_REPOSITORY_ROLES)
        expect(guard.canActivate(context([role]))).toBe(true);
      expect(() =>
        guard.canActivate(context(['TEACHING_SUPPORT_COORDINATOR'])),
      ).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context([]))).toThrow(ForbiddenException);
    },
  );

  it('expone la consulta paginada de proyectos con sus filtros', async () => {
    const filters = { page: 2, pageSize: 20, search: 'costa' };
    (service.projects as jest.Mock).mockResolvedValue({ items: [], total: 0 });
    await expect(resolver.repositoryProjects(filters)).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(service.projects).toHaveBeenCalledWith(filters);
  });

  it('limita la consulta de investigaciones a filtros compatibles', async () => {
    const filters = {
      page: 3,
      pageSize: 10,
      search: 'mar',
      sortBy: 'title',
      sortOrder: 'asc' as const,
    };
    (service.researchList as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
    });
    await resolver.repositoryResearch(filters);
    expect(service.researchList).toHaveBeenCalledWith(filters);
  });

  it('consulta resultados de investigación con filtros y paginación', async () => {
    const filters = {
      page: 1,
      pageSize: 10,
      researchId: '22222222-2222-4222-8222-222222222222',
      kind: 'ARTICLE' as const,
      reportingYear: 2025,
      sortBy: 'publicationDate',
      sortOrder: 'desc' as const,
    };
    (service.researchOutputs as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
    });
    await resolver.repositoryResearchOutputs(filters);
    expect(service.researchOutputs).toHaveBeenCalledWith(filters);
  });

  it('restringe consultas a los roles del repositorio y resuelve el conteo de resultados', () => {
    const reflector = new Reflector();
    expect(reflector.get<string[]>(ROLES_KEY, RepositoryResolver)).toEqual(
      ACADEMIC_REPOSITORY_ROLES,
    );
    expect(
      new RepositoryListRecordResolver().outputCount({
        _count: { outputs: 4 },
      }),
    ).toBe(4);
    expect(new RepositoryListRecordResolver().outputCount({})).toBe(0);
    expect(
      new ResearchOutputListRecordResolver().fiveYearImpactFactor({
        fiveYearImpactFactor: new Prisma.Decimal('3.25'),
      }),
    ).toBe('3.25');
    expect(
      new ResearchOutputListRecordResolver().fiveYearImpactFactor({
        fiveYearImpactFactor: '3.25',
      }),
    ).toBe('3.25');
  });
});
