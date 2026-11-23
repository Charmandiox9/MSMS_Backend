import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import {
  Args,
  Context,
  ID,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { EditorialKind } from '@prisma/client';
import type { Request } from 'express';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { EditorialAccessGuard } from './editorial-access.guard';
import {
  EditorialDraftInput,
  EditorialFilters,
  EditorialManagedEntry,
  EditorialManagedPage,
  EditorialPage,
  EditorialPublication,
  EditorialRevisionView,
  EditorialRoleOption,
  EditorialVersionInput,
} from './editorial.graphql';
import { EditorialService } from './editorial.service';

@Resolver()
export class EditorialResolver {
  constructor(
    private readonly editorial: EditorialService,
    private readonly access: EditorialAccessGuard,
  ) {}

  @Query(() => EditorialPage)
  async editorialPublications(
    @CurrentUser() user: CurrentUserPayload,
    @Context('req') req: Request,
    @Args('filters', { type: () => EditorialFilters, nullable: true })
    filters?: EditorialFilters,
  ) {
    const role = await this.access.readerRole(
      user,
      req.get('x-marsys-active-role'),
    );
    return this.editorial.publications(filters ?? new EditorialFilters(), role);
  }

  @Query(() => EditorialPublication)
  async editorialPublication(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Context('req') req: Request,
  ) {
    return this.editorial.publication(
      id,
      await this.access.readerRole(user, req.get('x-marsys-active-role')),
    );
  }

  @Query(() => EditorialPublication, { nullable: true })
  async editorialFeaturedPublication(
    @CurrentUser() user: CurrentUserPayload,
    @Context('req') req: Request,
  ) {
    return this.editorial.featuredPublication(
      await this.access.readerRole(user, req.get('x-marsys-active-role')),
    );
  }

  @Query(() => [EditorialRoleOption])
  @UseGuards(EditorialAccessGuard)
  editorialRoleOptions() {
    return this.editorial.roles();
  }

  @Query(() => EditorialManagedPage)
  @UseGuards(EditorialAccessGuard)
  editorialManagedEntries(
    @Args('filters', { type: () => EditorialFilters, nullable: true })
    filters?: EditorialFilters,
  ) {
    return this.editorial.managedEntries(filters ?? new EditorialFilters());
  }

  @Query(() => EditorialManagedEntry)
  @UseGuards(EditorialAccessGuard)
  editorialManagedEntry(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
  ) {
    return this.editorial.managedEntry(id);
  }

  @Mutation(() => EditorialManagedEntry)
  @UseGuards(EditorialAccessGuard)
  createEditorialEntry(
    @Args('kind', { type: () => EditorialKind }) kind: EditorialKind,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.editorial.create(kind, user.id);
  }

  @Mutation(() => EditorialManagedEntry)
  @UseGuards(EditorialAccessGuard)
  saveEditorialDraft(
    @Args('input') input: EditorialDraftInput,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.editorial.save(input, user.id);
  }

  @Mutation(() => EditorialManagedEntry)
  @UseGuards(EditorialAccessGuard)
  publishEditorialEntry(
    @Args('input') input: EditorialVersionInput,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.editorial.publish(input, user.id);
  }

  @Mutation(() => EditorialManagedEntry)
  @UseGuards(EditorialAccessGuard)
  archiveEditorialEntry(
    @Args('input') input: EditorialVersionInput,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.editorial.archive(input, user.id);
  }

  @Mutation(() => EditorialManagedEntry)
  @UseGuards(EditorialAccessGuard)
  setEditorialFeatured(
    @Args('input') input: EditorialVersionInput,
    @Args('featured') featured: boolean,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.editorial.feature(input, featured, user.id);
  }
}

@Resolver(() => EditorialRevisionView)
export class EditorialRevisionResolver {
  @ResolveField(() => [String])
  roleCodes(
    @Parent() revision: { audienceRoles: { role: { code: string } }[] },
  ) {
    return revision.audienceRoles.map(({ role }) => role.code).sort();
  }
}
