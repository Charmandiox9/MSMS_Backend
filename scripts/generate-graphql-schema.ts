import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';
import { printSchema } from 'graphql';
import { AssistantshipsResolver } from '../src/assistantships/assistantships.resolver';
import { AcademicReportsResolver } from '../src/academic/academic-reports.resolver';
import {
  RepositoryResolver,
  RepositoryListRecordResolver,
  ResearchOutputListRecordResolver,
} from '../src/academic-repository/repository.resolver';
import { AppResolver } from '../src/app.resolver';

async function generate() {
  const app = await NestFactory.createApplicationContext(
    GraphQLSchemaBuilderModule,
    { logger: false },
  );
  try {
    const schema = await app
      .get(GraphQLSchemaFactory)
      .create([
        AppResolver,
        AcademicReportsResolver,
        AssistantshipsResolver,
        RepositoryResolver,
        RepositoryListRecordResolver,
        ResearchOutputListRecordResolver,
      ]);
    writeFileSync(
      'src/schema.gql',
      '# ------------------------------------------------------\n# THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)\n# ------------------------------------------------------\n\n' +
        printSchema(schema) +
        '\n',
    );
  } finally {
    await app.close();
  }
}

void generate();
