import { ArgsType, Field, ID, ObjectType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { RepositoryListRecord } from './repository.graphql';

@ArgsType()
export class RepositoryIdArgs {
  @Field(() => ID) @IsUUID() id!: string;
}

@ObjectType()
export class RepositoryLinkedRecord {
  @Field(() => ID) id!: string;
  @Field(() => String) title!: string;
  @Field(() => String, { nullable: true }) code?: string | null;
}

@ObjectType()
export class RepositoryProjectDetail extends RepositoryListRecord {
  @Field(() => String, { nullable: true }) faculty!: string | null;
  @Field(() => String, { nullable: true }) resolution!: string | null;
  @Field(() => String, { nullable: true }) classification!: string | null;
  @Field(() => String, { nullable: true }) fundingSource!: string | null;
  @Field(() => String, { nullable: true }) program!: string | null;
  @Field(() => String, { nullable: true }) competition!: string | null;
  @Field(() => String, { nullable: true }) applicationArea!: string | null;
  @Field(() => String, { nullable: true }) participationScope!: string | null;
  @Field(() => Boolean, { nullable: true }) officialized!: boolean | null;
  @Field(() => Date, { nullable: true }) revisedEndsOn!: Date | null;
  @Field(() => Date, { nullable: true }) closedOn!: Date | null;
  @Field(() => String, { nullable: true }) currency!: string | null;
  @Field(() => String, { nullable: true }) totalAmount!: string | null;
  @Field(() => String, { nullable: true }) vraContribution!: string | null;
  @Field(() => String, { nullable: true }) vridtContribution!: string | null;
  @Field(() => String, { nullable: true }) recoveryAmount!: string | null;
  @Field(() => String, { nullable: true }) facultyContribution!: string | null;
  @Field(() => String, { nullable: true }) depreciationAmount!: string | null;
  @Field(() => String, { nullable: true }) profitabilityAmount!: string | null;
  @Field(() => String, { nullable: true }) folderUrl!: string | null;
  @Field(() => String, { nullable: true }) notes!: string | null;
  @Field(() => RepositoryLinkedRecord, { nullable: true })
  research!: RepositoryLinkedRecord | null;
}

@ObjectType()
export class RepositoryResearchDetail extends RepositoryListRecord {
  @Field(() => String, { nullable: true }) description!: string | null;
  @Field(() => ID, { nullable: true }) projectId!: string | null;
  @Field(() => RepositoryLinkedRecord, { nullable: true })
  project!: RepositoryLinkedRecord | null;
}
