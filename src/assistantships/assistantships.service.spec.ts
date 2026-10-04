import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantshipsService } from './assistantships.service';
import {
  AssistantshipFilters,
  AssistantshipState,
  RegisterAssistantshipInput,
} from './assistantships.dto';

const assignment = {
  id: 'assignment',
  courseId: 'course',
  semesterId: 'semester',
  nrc: '12345',
  teacher: { name: 'Docente', isActive: true },
  course: { name: 'Biología', code: 'BIO101' },
  semester: {
    id: 'semester',
    name: '2026-2',
    startsOn: new Date('2026-08-01'),
    endsOn: new Date('2026-12-31'),
  },
};
const assistant = {
  id: 'assistant',
  name: 'Estudiante',
  email: 'student@example.test',
  studentCode: null,
  isActive: true,
};
const record = {
  id: 'assistantship',
  startsOn: new Date('2026-08-01'),
  endsOn: new Date('2026-12-31'),
  approvedOn: new Date('2026-07-01'),
  weeklyHours: new Prisma.Decimal(4),
  schedules: [],
  approval: { assistant },
  teachingAssignment: assignment,
};
const validInput = (): RegisterAssistantshipInput =>
  Object.assign(new RegisterAssistantshipInput(), {
    assistantshipNrc: '20001',
    teachingAssignmentId: 'assignment',
    assistantName: 'Estudiante',
    assistantEmail: 'STUDENT@example.test',
    approvedOn: '2026-07-01',
    startsOn: '2026-08-01',
    endsOn: '2026-12-31',
    approvalConfirmed: true,
    weeklyHours: 4,
    schedules: [],
  });

describe('AssistantshipsService', () => {
  let service: AssistantshipsService;
  const transaction = {
    teachingAssignment: { findUnique: jest.fn() },
    teachingAssistant: { findUnique: jest.fn(), create: jest.fn() },
    assistantCourseApproval: { findUnique: jest.fn(), create: jest.fn() },
    assistantship: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(),
    assistantship: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn<
        Promise<unknown[]>,
        [Prisma.AssistantshipFindManyArgs]
      >(),
    },
    teachingAssignment: { findMany: jest.fn() },
    academicSemester: { findMany: jest.fn() },
    teacher: { findMany: jest.fn() },
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    jest.useFakeTimers({ now: new Date('2026-10-04T15:00:00Z') });
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    transaction.teachingAssignment.findUnique.mockResolvedValue(assignment);
    transaction.teachingAssistant.findUnique.mockResolvedValue(null);
    transaction.teachingAssistant.create.mockResolvedValue(assistant);
    transaction.assistantCourseApproval.findUnique.mockResolvedValue(null);
    transaction.assistantship.findMany.mockResolvedValue([]);
    transaction.assistantship.create.mockResolvedValue(record);
    const module = await Test.createTestingModule({
      providers: [
        AssistantshipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'America/Santiago' } },
      ],
    }).compile();
    service = module.get(AssistantshipsService);
  });
  afterEach(() => jest.useRealTimers());

  it('updates the NRC and replaces schedules, excluding its own record from conflicts', async () => {
    transaction.assistantship.findUnique.mockResolvedValue(record);
    transaction.assistantship.update.mockResolvedValue({
      ...record,
      nrc: '20002',
    });
    await service.update('assistantship', {
      ...validInput(),
      assistantshipNrc: '20002',
    });
    expect(transaction.assistantship.create).not.toHaveBeenCalled();
    expect(transaction.assistantship.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 'assistantship' } }),
      }),
    );
    expect(transaction.assistantship.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'assistantship' },
        data: expect.objectContaining({
          nrc: '20002',
          schedules: { deleteMany: {}, create: [] },
        }),
      }),
    );
  });

  it('rejects editing a missing assistantship', async () => {
    transaction.assistantship.findUnique.mockResolvedValue(null);
    await expect(service.update('missing', validInput())).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it('returns the institutional blocks and their predefined times with form options', async () => {
    prisma.academicSemester.findMany.mockResolvedValue([]);
    prisma.teacher.findMany.mockResolvedValue([]);
    const options = await service.options();
    expect(options.blocks.map((block) => block.code)).toEqual([
      'A',
      'B',
      'C',
      'C2',
      'D',
      'E',
      'F',
      'G',
      'H',
    ]);
    expect(options.blocks[0]).toEqual({
      code: 'A',
      startsAtMinute: 490,
      endsAtMinute: 580,
    });
    expect(options.blocks[8]).toEqual({
      code: 'H',
      startsAtMinute: 1290,
      endsAtMinute: 1380,
    });
  });

  it('registers the student, their course approval and the assistantship atomically', async () => {
    const result = await service.register(validInput());
    expect(result).toMatchObject({
      nrc: '12345',
      assistantName: 'Estudiante',
      weeklyHours: 4,
      state: 'ACTIVE',
    });
    expect(transaction.teachingAssistant.create).toHaveBeenCalledWith({
      data: {
        name: 'Estudiante',
        email: 'student@example.test',
        studentCode: null,
      },
    });
    expect(transaction.assistantCourseApproval.create).toHaveBeenCalledWith({
      data: {
        assistantId: 'assistant',
        courseId: 'course',
        approvedOn: new Date('2026-07-01'),
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('reuses existing profiles and approvals without changing history', async () => {
    transaction.teachingAssistant.findUnique.mockResolvedValue(assistant);
    transaction.assistantCourseApproval.findUnique.mockResolvedValue({
      approvedOn: new Date('2026-07-01'),
    });
    await service.register(validInput());
    expect(transaction.teachingAssistant.create).not.toHaveBeenCalled();
    expect(transaction.assistantCourseApproval.create).not.toHaveBeenCalled();
  });
  it.each([
    [{ approvalConfirmed: false }, 'APPROVAL_REQUIRED'],
    [{ approvedOn: '2026-08-01' }, 'APPROVAL_DATE'],
    [{ startsOn: '2026-08-02', endsOn: '2026-08-01' }, 'INVALID_PERIOD'],
    [{ approvedOn: '2026-02-30' }, 'INVALID_PERIOD'],
    [{ startsOn: '2026-08-01T12:00:00Z' }, 'INVALID_PERIOD'],
    [{ startsOn: '2026-07-20' }, 'SEMESTER_PERIOD'],
    [{ endsOn: '2027-01-01' }, 'SEMESTER_PERIOD'],
  ])('rejects invalid registration %o', async (patch, code) => {
    await expect(
      service.register({ ...validInput(), ...patch }),
    ).rejects.toMatchObject({ response: { code } });
    expect(transaction.assistantship.create).not.toHaveBeenCalled();
  });
  it('rejects a missing teaching assignment', async () => {
    transaction.teachingAssignment.findUnique.mockResolvedValue(null);
    await expect(service.register(validInput())).rejects.toMatchObject({
      response: { code: 'ASSIGNMENT_NOT_FOUND' },
    });
  });
  it('rejects inactive teachers', async () => {
    transaction.teachingAssignment.findUnique.mockResolvedValue({
      ...assignment,
      teacher: { isActive: false },
    });
    await expect(service.register(validInput())).rejects.toMatchObject({
      response: { code: 'INACTIVE_PROFILE' },
    });
  });
  it('rejects inactive students', async () => {
    transaction.teachingAssistant.findUnique.mockResolvedValue({
      ...assistant,
      isActive: false,
    });
    await expect(service.register(validInput())).rejects.toMatchObject({
      response: { code: 'INACTIVE_PROFILE' },
    });
  });
  it('rejects an email registered to a different student identity', async () => {
    transaction.teachingAssistant.findUnique.mockResolvedValue({
      ...assistant,
      name: 'Otro estudiante',
    });
    await expect(service.register(validInput())).rejects.toMatchObject({
      response: { code: 'ASSISTANT_IDENTITY' },
    });
  });
  it('rejects rewriting an existing approval date', async () => {
    transaction.assistantCourseApproval.findUnique.mockResolvedValue({
      approvedOn: new Date('2026-06-01'),
    });
    await expect(service.register(validInput())).rejects.toMatchObject({
      response: { code: 'APPROVAL_MISMATCH' },
    });
  });
  it.each([
    ['P2002', 'DUPLICATE'],
    ['P2034', 'RETRY'],
    ['P2003', 'INVALID_INPUT'],
  ])('translates Prisma %s errors', async (code, expected) => {
    transaction.assistantship.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('database detail', {
        code,
        clientVersion: 'test',
      }),
    );
    await expect(service.register(validInput())).rejects.toMatchObject({
      response: { code: expected },
    });
  });
  it('rejects overlapping draft schedules', async () => {
    const schedules = [
      { weekday: 1, startsAtMinute: 480, endsAtMinute: 540 },
      { weekday: 1, startsAtMinute: 500, endsAtMinute: 560 },
    ];
    await expect(
      service.register({ ...validInput(), schedules }),
    ).rejects.toMatchObject({ response: { code: 'SCHEDULE_CONFLICT' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects conflicts with another assistantship in an overlapping period', async () => {
    transaction.assistantship.findMany.mockResolvedValue([
      { schedules: [{ weekday: 1, startsAtMinute: 480, endsAtMinute: 540 }] },
    ]);
    await expect(
      service.register({
        ...validInput(),
        schedules: [{ weekday: 1, startsAtMinute: 500, endsAtMinute: 560 }],
      }),
    ).rejects.toMatchObject({ response: { code: 'SCHEDULE_CONFLICT' } });
  });
  it('allows adjacent schedule blocks', async () => {
    await service.register({
      ...validInput(),
      schedules: [
        { weekday: 1, startsAtMinute: 480, endsAtMinute: 540 },
        { weekday: 1, startsAtMinute: 540, endsAtMinute: 600 },
      ],
    });
    expect(transaction.assistantship.create).toHaveBeenCalled();
  });
  it('combines semester, teacher, search and status filters and clamps pagination', async () => {
    prisma.assistantship.count.mockResolvedValue(1);
    prisma.assistantship.groupBy.mockResolvedValue([
      { assistantId: 'assistant' },
    ]);
    prisma.teachingAssignment.findMany.mockResolvedValue([
      { semesterId: 'semester' },
    ]);
    prisma.assistantship.findMany.mockResolvedValue([record]);
    const filters = Object.assign(new AssistantshipFilters(), {
      semesterId: 'semester',
      teacherId: 'teacher',
      search: ' BIO ',
      state: AssistantshipState.ACTIVE,
      page: 100,
    });
    expect(await service.list(filters)).toMatchObject({
      page: 1,
      total: 1,
      assistants: 1,
      semesters: 1,
    });
    const query = prisma.assistantship.findMany.mock.calls[0][0];
    expect(query.skip).toBe(0);
    expect(query.where?.teachingAssignment).toEqual({
      semesterId: 'semester',
      teacherId: 'teacher',
    });
    expect(query.where?.startsOn).toEqual({ lte: new Date('2026-10-04') });
    expect(query.where?.OR).toHaveLength(3);
  });
  it.each([
    ['2026-11-01', '2026-12-31', AssistantshipState.SCHEDULED],
    ['2026-08-01', '2026-09-30', AssistantshipState.COMPLETED],
    ['2026-08-01', '2026-10-04', AssistantshipState.ACTIVE],
  ])(
    'computes status from date boundaries (%s to %s)',
    async (start, end, expected) => {
      transaction.assistantship.create.mockResolvedValue({
        ...record,
        startsOn: new Date(start),
        endsOn: new Date(end),
      });
      expect(
        (
          await service.register({
            ...validInput(),
            startsOn: start,
            endsOn: end,
          })
        ).state,
      ).toBe(expected);
    },
  );
  it('uses the campus calendar date instead of UTC at midnight', async () => {
    jest.setSystemTime(new Date('2026-10-05T00:30:00Z'));
    transaction.assistantship.create.mockResolvedValue({
      ...record,
      endsOn: new Date('2026-10-04'),
    });
    expect(
      (await service.register({ ...validInput(), endsOn: '2026-10-04' })).state,
    ).toBe(AssistantshipState.ACTIVE);
  });
  it('does not expose unexpected database errors', async () => {
    transaction.assistantship.create.mockRejectedValue(
      new Error('private database detail'),
    );
    await expect(service.register(validInput())).rejects.toMatchObject({
      response: {
        code: 'SERVER_ERROR',
        message: 'No se pudo registrar la ayudantía',
      },
    });
  });
});
