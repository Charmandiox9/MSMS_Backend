import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { EditorialKind } from '@prisma/client';
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
  EditorialVersionInput,
} from './editorial.graphql';
import { EditorialService } from './editorial.service';

@Resolver()
export class EditorialResolver {
  constructor(private readonly editorial: EditorialService) {}

  @Query(() => EditorialPage)
  editorialPublications(
    @Args('filters', { type: () => EditorialFilters, nullable: true })
    filters?: EditorialFilters,
  ) {
    return this.editorial.publications(filters ?? new EditorialFilters());
  }

  @Query(() => EditorialPublication)
  editorialPublication(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
  ) {
    return this.editorial.publication(id);
  }

  @Query(() => EditorialPublication, { nullable: true })
  editorialFeaturedPublication() {
    return this.editorial.featuredPublication();
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
