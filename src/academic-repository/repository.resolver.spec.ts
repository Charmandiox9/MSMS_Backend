import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ACADEMIC_REPOSITORY_ROLES } from '../academic/repository-access';
import {
  RepositoryResolver,
  RepositoryListRecordResolver,
} from './repository.resolver';
import { RepositoryService } from './repository.service';

describe('consultas GraphQL del repositorio académico', () => {
  const service = {
    projects: jest.fn(),
    researchList: jest.fn(),
  } as unknown as RepositoryService;
  const resolver = new RepositoryResolver(service);

  beforeEach(() => jest.clearAllMocks());

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
  });
});
