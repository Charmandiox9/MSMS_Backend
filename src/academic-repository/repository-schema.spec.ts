import { Test, TestingModule } from '@nestjs/testing';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';
import { graphql, GraphQLSchema, isInputObjectType } from 'graphql';
import { Prisma } from '@prisma/client';
import {
  RepositoryResolver,
  RepositoryListRecordResolver,
  ResearchOutputListRecordResolver,
} from './repository.resolver';
import { RepositoryService } from './repository.service';

describe('contrato del esquema GraphQL del repositorio', () => {
  let module: TestingModule;
  let schema: GraphQLSchema;
  const project = jest.fn();
  const research = jest.fn();
  const researchOutput = jest.fn();
  const resolver = new RepositoryResolver({
    project,
    research,
    researchOutput,
  } as unknown as RepositoryService);
  const id = '22222222-2222-4222-8222-222222222222';
  const updatedAt = new Date('2026-10-14T12:00:00.123Z');

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [GraphQLSchemaBuilderModule],
    }).compile();
    schema = await module
      .get(GraphQLSchemaFactory)
      .create([
        RepositoryResolver,
        RepositoryListRecordResolver,
        ResearchOutputListRecordResolver,
      ]);
  });
  afterAll(async () => module.close());

  it('publica el filtro de estado como enum y rechaza valores desconocidos en GraphQL', async () => {
    const filters = schema.getType('RepositoryListFilters');
    if (!isInputObjectType(filters))
      throw new Error('No se generó el tipo de filtros');
    expect(filters.getFields().status.type.toString()).toBe('ProjectStatus');
    const result = await graphql({
      schema,
      source:
        'query($filters: RepositoryListFilters!) { repositoryProjects(filters: $filters) { total } }',
      variableValues: { filters: { status: 'NO_EXISTE' } },
    });
    expect(result.errors).toHaveLength(1);
  });

  it('serializa importes exactos, fechas nulas y versión completa en un detalle de proyecto', async () => {
    project.mockResolvedValue({
      id,
      title: 'Proyecto',
      academicUnit: 'FCM',
      code: null,
      reportingYear: 2026,
      status: 'REGISTERED',
      participants: [],
      startsOn: null,
      endsOn: null,
      revisedEndsOn: null,
      closedOn: null,
      updatedAt,
      createdAt: updatedAt,
      _count: { outputs: 2 },
      totalAmount: new Prisma.Decimal('9999999999999999.99'),
      vraContribution: new Prisma.Decimal(0),
      research: null,
    });
    const result = await graphql({
      schema,
      source:
        'query($id: ID!) { repositoryProject(id: $id) { id updatedAt startsOn totalAmount vraContribution recoveryAmount outputCount research { id } } }',
      variableValues: { id },
      rootValue: {
        repositoryProject: () => resolver.repositoryProject({ id }),
      },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.repositoryProject).toEqual({
      id,
      updatedAt: updatedAt.toISOString(),
      startsOn: null,
      totalAmount: '9999999999999999.99',
      vraContribution: '0',
      recoveryAmount: null,
      outputCount: 2,
      research: null,
    });
  });

  it('devuelve el vínculo y los datos científicos de investigación sin datos inventados', async () => {
    research.mockResolvedValue({
      id,
      title: 'Investigación',
      description: null,
      projectId: null,
      project: null,
      participants: [],
      _count: { outputs: 0 },
      updatedAt,
    });
    const result = await graphql({
      schema,
      source:
        'query($id: ID!) { repositoryResearchDetail(id: $id) { id description projectId outputCount project { id title code } } }',
      variableValues: { id },
      rootValue: {
        repositoryResearchDetail: () =>
          resolver.repositoryResearchDetail({ id }),
      },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.repositoryResearchDetail).toEqual({
      id,
      description: null,
      projectId: null,
      project: null,
      outputCount: 0,
    });
  });

  it('serializa el factor de impacto y conserva autorías y proyectos en el detalle de resultado', async () => {
    researchOutput.mockResolvedValue({
      id,
      fiveYearImpactFactor: new Prisma.Decimal('3.125'),
      publicationDate: null,
      updatedAt,
      authors: [{ id, name: 'Autora', position: 1 }],
      projects: [{ project: { id, title: 'Proyecto', code: null } }],
    });
    const result = await graphql({
      schema,
      source:
        'query($id: ID!) { repositoryResearchOutput(id: $id) { id updatedAt fiveYearImpactFactor publicationDate authors { id name position } projects { project { id title code } } } }',
      variableValues: { id },
      rootValue: {
        repositoryResearchOutput: () =>
          resolver.repositoryResearchOutput({ id }),
      },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.repositoryResearchOutput).toMatchObject({
      id,
      updatedAt: updatedAt.toISOString(),
      fiveYearImpactFactor: '3.125',
      publicationDate: null,
      authors: [{ id, name: 'Autora', position: 1 }],
      projects: [{ project: { id, title: 'Proyecto', code: null } }],
    });
  });
});
