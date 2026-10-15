import {
  Args,
  Int,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { Roles } from '../auth/decorators/roles.decorator';
import { ACADEMIC_REPOSITORY_ROLES } from '../academic/repository-access';
import { RepositoryQueryDto } from './repository.dto';
import { RepositoryService } from './repository.service';
import {
  RepositoryListFilters,
  RepositoryListPage,
  RepositoryListRecord,
} from './repository.graphql';

@Resolver(() => RepositoryListRecord)
export class RepositoryListRecordResolver {
  @ResolveField(() => Int)
  outputCount(@Parent() record: { _count?: { outputs?: number } }) {
    return record._count?.outputs ?? 0;
  }
}

@Resolver()
@Roles(...ACADEMIC_REPOSITORY_ROLES)
export class RepositoryResolver {
  constructor(private readonly service: RepositoryService) {}

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
}
