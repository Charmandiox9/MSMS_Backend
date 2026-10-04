import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { ArgsType, Field } from '@nestjs/graphql';
import {
  AssistantshipAssignmentOption,
  AssistantshipFilters,
  AssistantshipOptions,
  AssistantshipPage,
  AssistantshipView,
  RegisterAssistantshipInput,
} from './assistantships.dto';
import { AssistantshipsGuard } from './assistantships.guard';
import { AssistantshipsService } from './assistantships.service';

@ArgsType()
export class AssistantshipSemesterArgs {
  @Field(() => ID) @IsUUID() semesterId!: string;
}

@Resolver()
@UseGuards(AssistantshipsGuard)
export class AssistantshipsResolver {
  constructor(private readonly service: AssistantshipsService) {}

  @Query(() => AssistantshipPage)
  assistantships(
    @Args('filters', { nullable: true, type: () => AssistantshipFilters })
    filters?: AssistantshipFilters,
  ) {
    return this.service.list(filters ?? new AssistantshipFilters());
  }

  @Query(() => AssistantshipOptions)
  assistantshipOptions() {
    return this.service.options();
  }

  @Query(() => [AssistantshipAssignmentOption])
  assistantshipAssignments(@Args() args: AssistantshipSemesterArgs) {
    return this.service.assignments(args.semesterId);
  }

  @Mutation(() => AssistantshipView)
  registerAssistantship(@Args('input') input: RegisterAssistantshipInput) {
    return this.service.register(input);
  }
}
