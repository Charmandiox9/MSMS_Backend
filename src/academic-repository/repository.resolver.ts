import {
  Args,
  Int,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { Prisma } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { ACADEMIC_REPOSITORY_ROLES } from '../academic/repository-access';
import { RepositoryQueryDto, ResearchOutputQueryDto } from './repository.dto';
import { RepositoryService } from './repository.service';
import {
  RepositoryIdArgs,
  RepositoryProjectDetail,
  RepositoryResearchDetail,
} from './repository-detail.graphql';
import {
  RepositoryListFilters,
  RepositoryListPage,
  RepositoryListRecord,
  ResearchOutputListRecord,
  ResearchOutputListFilters,
  ResearchOutputListPage,
} from './repository.graphql';

@Resolver(() => RepositoryListRecord)
export class RepositoryListRecordResolver {
  @ResolveField(() => Int)
  outputCount(@Parent() record: { _count?: { outputs?: number } }) {
    return record._count?.outputs ?? 0;
  }
}

@Resolver(() => ResearchOutputListRecord)
export class ResearchOutputListRecordResolver {
  @ResolveField(() => String, { nullable: true })
  fiveYearImpactFactor(
    @Parent() record: { fiveYearImpactFactor: Prisma.Decimal | string | null },
  ) {
    return record.fiveYearImpactFactor?.toString() ?? null;
  }
}

@Resolver()
@Roles(...ACADEMIC_REPOSITORY_ROLES)
export class RepositoryResolver {
  constructor(private readonly service: RepositoryService) {}

  @Query(() => RepositoryProjectDetail)
  async repositoryProject(@Args() args: RepositoryIdArgs) {
    const row = await this.service.project(args.id);
    return {
      ...row,
      outputCount: row._count.outputs,
      totalAmount: row.totalAmount?.toString() ?? null,
      vraContribution: row.vraContribution?.toString() ?? null,
      vridtContribution: row.vridtContribution?.toString() ?? null,
      recoveryAmount: row.recoveryAmount?.toString() ?? null,
      facultyContribution: row.facultyContribution?.toString() ?? null,
      depreciationAmount: row.depreciationAmount?.toString() ?? null,
      profitabilityAmount: row.profitabilityAmount?.toString() ?? null,
    };
  }

  @Query(() => RepositoryResearchDetail)
  async repositoryResearchDetail(@Args() args: RepositoryIdArgs) {
    const row = await this.service.research(args.id);
    return { ...row, outputCount: row._count.outputs };
  }

  @Query(() => ResearchOutputListRecord)
  async repositoryResearchOutput(@Args() args: RepositoryIdArgs) {
    const row = await this.service.researchOutput(args.id);
    return {
      ...row,
      fiveYearImpactFactor: row.fiveYearImpactFactor?.toString() ?? null,
    };
  }

  @Query(() => RepositoryListPage)
  repositoryProjects(
    @Args('filters', { nullable: true, type: () => RepositoryListFilters })
    filters?: RepositoryListFilters,
  ) {
    const value = filters ?? new RepositoryListFilters();
    return this.service.projects({
      page: value.page,
      pageSize: value.pageSize,
      search: value.search,
      status: value.status,
      reportingYear: value.reportingYear,
      sortBy: value.sortBy as RepositoryQueryDto['sortBy'],
      sortOrder: value.sortOrder,
    });
  }

  @Query(() => RepositoryListPage)
  repositoryResearch(
    @Args('filters', { nullable: true, type: () => RepositoryListFilters })
    filters?: RepositoryListFilters,
  ) {
    const { page, pageSize, search, sortBy, sortOrder } =
      filters ?? new RepositoryListFilters();
    return this.service.researchList({
      page,
      pageSize,
      search,
      sortBy: sortBy as RepositoryQueryDto['sortBy'],
      sortOrder,
    });
  }

  @Query(() => ResearchOutputListPage)
  repositoryResearchOutputs(
    @Args('filters', { nullable: true, type: () => ResearchOutputListFilters })
    filters?: ResearchOutputListFilters,
  ) {
    const value = filters ?? new ResearchOutputListFilters();
    return this.service.researchOutputs({
      page: value.page,
      pageSize: value.pageSize,
      search: value.search,
      researchId: value.researchId,
      kind: value.kind,
      reportingYear: value.reportingYear,
      sortBy: value.sortBy as ResearchOutputQueryDto['sortBy'],
      sortOrder: value.sortOrder,
    });
  }
}
