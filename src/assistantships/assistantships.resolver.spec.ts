import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AssistantshipsGuard } from './assistantships.guard';
import { AssistantshipsResolver } from './assistantships.resolver';
import { AssistantshipsService } from './assistantships.service';
import {
  AssistantshipFilters,
  AssistantshipStudentsArgs,
  RegisterAssistantshipInput,
} from './assistantships.dto';

describe('AssistantshipsResolver contract', () => {
  const service = {
    list: jest.fn(),
    get: jest.fn(),
    options: jest.fn(),
    students: jest.fn(),
    careerCourses: jest.fn(),
    assignments: jest.fn(),
    register: jest.fn(),
    update: jest.fn(),
  };
  let resolver: AssistantshipsResolver;
  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AssistantshipsResolver,
        { provide: AssistantshipsService, useValue: service },
      ],
    })
      .overrideGuard(AssistantshipsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    resolver = module.get(AssistantshipsResolver);
  });
  it('protects every resolver with the permission guard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AssistantshipsResolver),
    ).toContain(AssistantshipsGuard);
  });
  it('supplies pagination defaults when filters are absent', () => {
    void resolver.assistantships();
    expect(service.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });
  it('delegates single assistantship lookup to the service', () => {
    void resolver.assistantship({ id: 'assistantship-123' });
    expect(service.get).toHaveBeenCalledWith('assistantship-123');
  });
  it('delegates registration and assignment queries to the service', () => {
    const input = new RegisterAssistantshipInput();
    void resolver.registerAssistantship(input);
    void resolver.updateAssistantship('assistantship', input);
    void resolver.assistantshipAssignments({ semesterId: 'semester' });
    expect(service.register).toHaveBeenCalledWith(input);
    expect(service.update).toHaveBeenCalledWith('assistantship', input);
    expect(service.assignments).toHaveBeenCalledWith('semester');
  });
  it('validates the update ID separately without rejecting the sibling input argument', async () => {
    const types: unknown[] = Reflect.getMetadata(
      'design:paramtypes', AssistantshipsResolver.prototype, 'updateAssistantship',
    );
    expect(types[0]).toBe(String);
    const pipe = new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
    });
    await expect(pipe.transform('11111111-1111-4111-8111-111111111111', {
      type: 'body', metatype: String, data: 'id',
    })).resolves.toBe('11111111-1111-4111-8111-111111111111');
  });
  it('delegates protected student search and career course lookups', () => {
    void resolver.assistantshipStudents({ search: 'ana' });
    void resolver.assistantshipCareerCourses({ careerId: 'career' });
    expect(service.students).toHaveBeenCalledWith('ana');
    expect(service.careerCourses).toHaveBeenCalledWith('career');
  });
  it('validates IDs, email, confirmation, dates, hours and nested schedules', () => {
    const input = plainToInstance(RegisterAssistantshipInput, {
      teachingAssignmentId: 'bad',
      assistantshipNrc: ' ',
      approvedOn: 'bad',
      startsOn: 'bad',
      endsOn: 'bad',
      approvalConfirmed: 'yes',
      weeklyHours: 169,
      schedules: [{ weekday: 8, startsAtMinute: -1, endsAtMinute: 1500 }],
    });
    const fields = validateSync(input).map((error) => error.property);
    expect(fields).toEqual(
      expect.arrayContaining([
        'teachingAssignmentId',
        'assistantshipNrc',
        'studentId',
        'approvedOn',
        'startsOn',
        'endsOn',
        'approvalConfirmed',
        'weeklyHours',
        'schedules',
      ]),
    );
  });
  it('requires at least two characters for protected student search', () => {
    const input = plainToInstance(AssistantshipStudentsArgs, { search: ' a ' });
    expect(input.search).toBe('a');
    expect(validateSync(input).map((error) => error.property)).toContain(
      'search',
    );
  });
  it('rejects excessive page sizes and invalid states', () => {
    expect(
      validateSync(
        plainToInstance(AssistantshipFilters, {
          pageSize: 100,
          page: 0,
          state: 'UNKNOWN',
        }),
      ).map((error) => error.property),
    ).toEqual(expect.arrayContaining(['pageSize', 'page', 'state']));
  });
});

describe('Assistantships GraphQL schema', () => {
  it('generates the complete executable code-first contract', async () => {
    const module = await Test.createTestingModule({
      imports: [GraphQLSchemaBuilderModule],
    }).compile();
    const schema = await module
      .get(GraphQLSchemaFactory)
      .create([AssistantshipsResolver]);
    expect(Object.keys(schema.getQueryType()!.getFields())).toEqual(
      expect.arrayContaining([
        'assistantships',
        'assistantship',
        'assistantshipOptions',
        'assistantshipAssignments',
        'assistantshipStudents',
      ]),
    );
    expect(
      schema
        .getMutationType()!
        .getFields()
        .registerAssistantship.type.toString(),
    ).toBe('AssistantshipView!');
    expect(schema.getType('RegisterAssistantshipInput')).toBeDefined();
    await module.close();
  });
});
