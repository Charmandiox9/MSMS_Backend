import { Test } from '@nestjs/testing';
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
  RegisterAssistantshipInput,
} from './assistantships.dto';

describe('AssistantshipsResolver contract', () => {
  const service = {
    list: jest.fn(),
    options: jest.fn(),
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
  it('delegates registration and assignment queries to the service', () => {
    const input = new RegisterAssistantshipInput();
    void resolver.registerAssistantship(input);
    void resolver.updateAssistantship({ id: 'assistantship' }, input);
    void resolver.assistantshipAssignments({ semesterId: 'semester' });
    expect(service.register).toHaveBeenCalledWith(input);
    expect(service.update).toHaveBeenCalledWith('assistantship', input);
    expect(service.assignments).toHaveBeenCalledWith('semester');
  });
  it('validates IDs, email, confirmation, dates, hours and nested schedules', () => {
    const input = plainToInstance(RegisterAssistantshipInput, {
      teachingAssignmentId: 'bad',
      assistantName: ' ',
      assistantEmail: 'bad',
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
        'assistantName',
        'assistantEmail',
        'approvedOn',
        'startsOn',
        'endsOn',
        'approvalConfirmed',
        'weeklyHours',
        'schedules',
      ]),
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
        'assistantshipOptions',
        'assistantshipAssignments',
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
