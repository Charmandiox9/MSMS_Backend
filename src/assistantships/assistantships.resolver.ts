import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
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
  AssistantshipStudentOption,
  AssistantshipStudentsArgs,
  AssistantshipCourseOption,
  AssistantshipTariffOption,
  AssistantshipBudgetSummary,
  SaveAssistantshipTariffInput,
} from './assistantships.dto';
import { AssistantshipsGuard } from './assistantships.guard';
import { AssistantshipsService } from './assistantships.service';

@ArgsType()
export class AssistantshipSemesterArgs {
  @Field(() => ID) @IsUUID() semesterId!: string;
}

@ArgsType()
export class AssistantshipIdArgs {
  @Field(() => ID) @IsUUID() id!: string;
}

@ArgsType()
export class AssistantshipCareerArgs {
  @Field(() => ID) @IsUUID() careerId!: string;
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

  @Query(() => AssistantshipView, { nullable: true })
  assistantship(@Args() args: AssistantshipIdArgs) {
    return this.service.get(args.id);
  }

  @Query(() => AssistantshipOptions)
  assistantshipOptions() {
    return this.service.options();
  }

  @Query(() => [AssistantshipStudentOption])
  assistantshipStudents(@Args() args: AssistantshipStudentsArgs) {
    return this.service.students(args.search);
  }

  @Query(() => [AssistantshipCourseOption])
  assistantshipCareerCourses(@Args() args: AssistantshipCareerArgs) {
    return this.service.careerCourses(args.careerId);
  }

  @Query(() => [AssistantshipAssignmentOption])
  assistantshipAssignments(@Args() args: AssistantshipSemesterArgs) {
    return this.service.assignments(args.semesterId);
  }

  @Query(() => [AssistantshipTariffOption])
  assistantshipTariffs(@Args() args: AssistantshipSemesterArgs) {
    return this.service.tariffs(args.semesterId);
  }

  @Query(() => AssistantshipBudgetSummary)
  assistantshipBudgetSummary(@Args() args: AssistantshipSemesterArgs) {
    return this.service.budgetSummary(args.semesterId);
  }

  @Mutation(() => AssistantshipTariffOption)
  saveAssistantshipTariff(@Args('input') input: SaveAssistantshipTariffInput) {
    return this.service.saveTariff(input);
  }

  @Mutation(() => Boolean)
  deleteAssistantshipTariff(@Args() args: AssistantshipIdArgs) {
    return this.service.deleteTariff(args.id);
  }

  @Mutation(() => AssistantshipView)
  registerAssistantship(@Args('input') input: RegisterAssistantshipInput) {
    return this.service.register(input);
  }

  @Mutation(() => AssistantshipView)
  updateAssistantship(
    @Args('id', { type: () => ID }, new ParseUUIDPipe()) id: string,
    @Args('input') input: RegisterAssistantshipInput,
  ) {
    return this.service.update(id, input);
  }
}
