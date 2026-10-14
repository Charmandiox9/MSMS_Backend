import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ACADEMIC_REPOSITORY_ROLES } from '../academic/repository-access';
import { RepositoryService } from './repository.service';
import {
  ProjectInputDto,
  ResearchInputDto,
  RepositoryQueryDto,
  RepositoryVersionDto,
  UpdateProjectDto,
  UpdateResearchDto,
} from './repository.dto';

// REST matches the existing academic maintenance API and its validation contracts.
@Controller('academic/projects')
@Roles(...ACADEMIC_REPOSITORY_ROLES)
export class ProjectsController {
  constructor(private readonly service: RepositoryService) {}
  @Get() list(@Query() query: RepositoryQueryDto) {
    return this.service.projects(query);
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.project(id);
  }
  @Post() create(@Body() input: ProjectInputDto) {
    return this.service.createProject(input);
  }
  @Put(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateProjectDto,
  ) {
    return this.service.updateProject(id, input);
  }
  @Delete(':id') remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() input: RepositoryVersionDto,
  ) {
    return this.service.deleteProject(id, input.expectedUpdatedAt);
  }
}

@Controller('academic/research')
@Roles(...ACADEMIC_REPOSITORY_ROLES)
export class ResearchController {
  constructor(private readonly service: RepositoryService) {}
  @Get() list(@Query() query: RepositoryQueryDto) {
    return this.service.researchList(query);
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.research(id);
  }
  @Post() create(@Body() input: ResearchInputDto) {
    return this.service.createResearch(input);
  }
  @Put(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateResearchDto,
  ) {
    return this.service.updateResearch(id, input);
  }
  @Delete(':id') remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() input: RepositoryVersionDto,
  ) {
    return this.service.deleteResearch(id, input.expectedUpdatedAt);
  }
}
