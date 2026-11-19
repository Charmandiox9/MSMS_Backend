import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantshipsService } from './assistantships.service';
import { SemesterBudgetsService } from '../semester-budgets/semester-budgets.service';
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
    isActive: true,
    name: '2026-2',
    startsOn: new Date('2026-08-01'),
    endsOn: new Date('2026-12-31'),
  },
};
const assistant = {
  id: 'assistant',
  studentId: 'student',
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
  tariffId: 'tariff',
  tariffRateClp: new Prisma.Decimal(10000),
  tariff: {
    id: 'tariff',
    name: 'Base',
    monthlyRateClp: new Prisma.Decimal(10000),
  },
  schedules: [],
  approval: { assistant },
  teachingAssignmentId: assignment.id,
  semesterId: assignment.semesterId,
  courseId: assignment.courseId,
  careerId: null,
  courseNrc: assignment.nrc,
  course: assignment.course,
  semester: assignment.semester,
  teachingAssignment: assignment,
};
const validInput = (): RegisterAssistantshipInput =>
  Object.assign(new RegisterAssistantshipInput(), {
    semesterId: 'semester',
    assistantshipNrc: '20001',
    studentId: 'student',
    tariffId: 'tariff',
    teachingAssignmentId: 'assignment',
    approvedOn: '2026-07-01',
    startsOn: '2026-08-01',
    endsOn: '2026-12-31',
    approvalConfirmed: true,
    weeklyHours: 4,
    schedules: [{ weekday: 1, startsAtMinute: 490, endsAtMinute: 580 }],
  });

describe('AssistantshipsService', () => {
  let service: AssistantshipsService;
  const transaction = {
    assistantshipApplication: { findUnique: jest.fn(), updateMany: jest.fn() },
    teachingAssignment: { findUnique: jest.fn() },
    teachingAssistant: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    student: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    academicSemester: { findUnique: jest.fn(), findFirst: jest.fn() },
    curriculumVersion: { findUnique: jest.fn() },
    curriculumCourse: { findFirst: jest.fn() },
    assistantCourseApproval: { findUnique: jest.fn(), create: jest.fn() },
    assistantship: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    assistantshipTariff: { findFirst: jest.fn() },
  };
  const prisma = {
    findPiiIds: jest.fn(),
    $transaction: jest.fn(),
    assistantship: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn<
        Promise<unknown[]>,
        [Prisma.AssistantshipFindManyArgs]
      >(),
    },
    teachingAssignment: { findMany: jest.fn() },
    academicSemester: { findMany: jest.fn(), findUnique: jest.fn() },
    teacher: { findMany: jest.fn() },
    career: { findMany: jest.fn() },
    student: { findUnique: jest.fn(), findMany: jest.fn() },
    assistantshipTariff: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    course: { findMany: jest.fn() },
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.findPiiIds.mockResolvedValue([]);
    jest.useFakeTimers({ now: new Date('2026-10-04T15:00:00Z') });
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    transaction.teachingAssignment.findUnique.mockResolvedValue(assignment);
    transaction.teachingAssistant.findFirst.mockResolvedValue(null);
    transaction.teachingAssistant.update.mockResolvedValue(assistant);
    transaction.student.findUnique.mockResolvedValue({
      id: 'student',
      name: assistant.name,
      email: assistant.email,
      careerCurriculumVersionId: 'curriculum',
    });
    transaction.academicSemester.findUnique.mockResolvedValue(
      assignment.semester,
    );
    transaction.academicSemester.findFirst.mockResolvedValue(
      assignment.semester,
    );
    prisma.career.findMany.mockResolvedValue([]);
    transaction.teachingAssistant.create.mockResolvedValue(assistant);
    transaction.assistantCourseApproval.findUnique.mockResolvedValue(null);
    transaction.assistantship.findMany.mockResolvedValue([]);
    transaction.assistantship.create.mockResolvedValue(record);
    transaction.assistantshipTariff.findFirst.mockResolvedValue({
      id: 'tariff',
      semesterId: 'semester',
      name: 'Base',
      monthlyRateClp: new Prisma.Decimal(10000),
    });
    prisma.assistantshipTariff.findMany.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        AssistantshipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'America/Santiago' } },
        {
          provide: SemesterBudgetsService,
          useValue: { assistantshipSummary: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(AssistantshipsService);
  });
  afterEach(() => jest.useRealTimers());

  it('assigns a semester tariff and calculates the estimated amount using 30-day months', async () => {
    const result = await service.register(validInput());
    expect(transaction.assistantship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tariffId: 'tariff',
          tariffRateClp: new Prisma.Decimal(10000),
        }),
      }),
    );
    expect(result.tariffName).toBe('Base');
    expect(result.estimatedAmountClp).toBe(204000);
  });

  it('preserves the historical tariff snapshot when the configured rate changes', async () => {
    const previous = { ...record, tariffRateClp: new Prisma.Decimal(9000) };
    transaction.assistantship.findUnique.mockResolvedValue(previous);
    transaction.assistantship.update.mockResolvedValue(previous);
    const result = await service.update('assistantship', validInput());
    expect(transaction.assistantship.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tariffRateClp: previous.tariffRateClp,
        }),
      }),
    );
    expect(result.estimatedAmountClp).toBe(183600);
  });

  it('creates semester-scoped tariffs using CLP decimal storage', async () => {
    prisma.academicSemester.findUnique.mockResolvedValue({ id: 'semester' });
    prisma.assistantshipTariff.findFirst.mockResolvedValue(null);
    prisma.assistantshipTariff.create.mockResolvedValue({
      id: 'tariff',
      semesterId: 'semester',
      name: 'Base',
      monthlyRateClp: new Prisma.Decimal(30000),
    });
    await expect(
      service.saveTariff({
        semesterId: 'semester',
        name: ' Base ',
        monthlyRateClp: 30000,
      }),
    ).resolves.toMatchObject({
      id: 'tariff',
      semesterId: 'semester',
      name: 'Base',
      monthlyRateClp: 30000,
    });
    expect(prisma.assistantshipTariff.create).toHaveBeenCalledWith({
      data: {
        semesterId: 'semester',
        name: 'Base',
        monthlyRateClp: new Prisma.Decimal(30000),
      },
    });
  });

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
          schedules: {
            deleteMany: {},
            create: [
              {
                weekday: 1,
                startsAtMinute: 490,
                endsAtMinute: 580,
                location: null,
              },
            ],
          },
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
  it('searches registered students by protected name, email or RUT and returns their career', async () => {
    prisma.findPiiIds.mockResolvedValue(['student']);
    prisma.student.findMany.mockResolvedValue([
      {
        id: 'student',
        name: 'Ana Pérez Soto',
        givenNames: 'Ana',
        paternalSurname: 'Pérez',
        maternalSurname: 'Soto',
        email: 'ana@example.test',
        rut: '12345678-9',
        careerId: 'career',
        career: { id: 'career', name: 'Biología Marina' },
        careerCurriculumVersionId: null,
        careerCurriculumVersion: null,
      },
    ]);
    await expect(service.students('  12345678-9  ')).resolves.toEqual([
      {
        id: 'student',
        name: 'Ana Pérez Soto',
        email: 'ana@example.test',
        rut: '12345678-9',
        careerCurriculumVersionId: null,
        careerId: 'career',
        careerName: 'Biología Marina',
      },
    ]);
    expect(prisma.findPiiIds).toHaveBeenCalledWith('Student', '12345678-9', [
      'name',
      'givenNames',
      'paternalSurname',
      'maternalSurname',
      'email',
      'personalEmail',
      'rut',
    ]);
  });

  it('links an existing student, records course approval and creates the assistantship atomically', async () => {
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
        studentId: 'student',
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
    transaction.teachingAssistant.findFirst.mockResolvedValue(assistant);
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
  it('requires an existing student, weekly hours and at least one schedule', async () => {
    await expect(
      service.register({ ...validInput(), studentId: '' }),
    ).rejects.toMatchObject({ response: { code: 'STUDENT_REQUIRED' } });
    await expect(
      service.register({ ...validInput(), weeklyHours: 0 }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_INPUT' } });
    await expect(
      service.register({ ...validInput(), schedules: [] }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_SCHEDULE' } });
  });
  it('rejects inactive students', async () => {
    transaction.teachingAssistant.findFirst.mockResolvedValue({
      ...assistant,
      isActive: false,
    });
    await expect(service.register(validInput())).rejects.toMatchObject({
      response: { code: 'INACTIVE_PROFILE' },
    });
  });
  it('rejects a student ID that does not exist', async () => {
    transaction.student.findUnique.mockResolvedValue(null);
    await expect(
      service.register({ ...validInput(), studentId: 'other-student' }),
    ).rejects.toMatchObject({
      response: { code: 'STUDENT_REQUIRED' },
    });
  });
  it('uses the registered student identity and links the existing assistant', async () => {
    transaction.teachingAssistant.findFirst.mockResolvedValue({
      ...assistant,
      name: 'Old name',
    });
    await service.register(validInput());
    expect(transaction.teachingAssistant.update).toHaveBeenCalledWith({
      where: { id: assistant.id },
      data: {
        studentId: 'student',
        name: 'Estudiante',
        email: 'student@example.test',
      },
    });
    expect(transaction.student.create).not.toHaveBeenCalled();
  });
  it('never creates or modifies a student while registering an assistantship', async () => {
    await service.register(validInput());
    expect(transaction.student.create).not.toHaveBeenCalled();
    expect(transaction.student.update).not.toHaveBeenCalled();
  });

  it('links an approved application in the assistantship registration transaction', async () => {
    const input = { ...validInput(), applicationId: 'application-1' };
    transaction.assistantshipApplication.findUnique.mockResolvedValue({
      id: input.applicationId,
      status: 'APPROVED',
      studentId: input.studentId,
      assistantshipId: null,
    });
    transaction.assistantshipApplication.updateMany.mockResolvedValue({
      count: 1,
    });
    await service.register(input);
    expect(
      transaction.assistantshipApplication.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: input.applicationId,
        status: 'APPROVED',
        assistantshipId: null,
      },
      data: { assistantshipId: record.id, studentId: input.studentId },
    });
  });

  it('rejects a completed application before creating another assistantship', async () => {
    transaction.assistantshipApplication.findUnique.mockResolvedValue({
      status: 'APPROVED',
      assistantshipId: 'existing',
    });
    await expect(
      service.register({ ...validInput(), applicationId: 'app' }),
    ).rejects.toMatchObject({
      response: { code: 'APPLICATION_UNAVAILABLE' },
    });
    expect(transaction.assistantship.create).not.toHaveBeenCalled();
  });

  it('rejects a different student when the application already matches a record', async () => {
    transaction.assistantshipApplication.findUnique.mockResolvedValue({
      status: 'APPROVED',
      assistantshipId: null,
      studentId: 'other',
    });
    await expect(
      service.register({ ...validInput(), applicationId: 'app' }),
    ).rejects.toMatchObject({
      response: { code: 'APPLICATION_STUDENT' },
    });
    expect(transaction.assistantship.create).not.toHaveBeenCalled();
  });
  it('registers a past course without a teaching assignment but with an assistantship NRC', async () => {
    const semester = {
      ...assignment.semester,
      id: 'past',
      isActive: false,
      startsOn: new Date('2025-08-01'),
      endsOn: new Date('2025-12-31'),
    };
    transaction.academicSemester.findUnique.mockResolvedValue(semester);
    transaction.curriculumCourse.findFirst.mockResolvedValue({
      courseId: 'course',
    });
    transaction.assistantship.create.mockResolvedValue({
      ...record,
      teachingAssignment: null,
      teachingAssignmentId: null,
      startsOn: semester.startsOn,
      endsOn: semester.endsOn,
      semester,
      semesterId: 'past',
      courseNrc: null,
      careerId: 'career',
    });
    const result = await service.register({
      ...validInput(),
      semesterId: 'past',
      courseId: 'course',
      careerId: 'career',
      teachingAssignmentId: undefined,
      approvedOn: '2025-07-01',
      startsOn: '2025-08-01',
      endsOn: '2025-12-31',
    });
    expect(result).toMatchObject({
      semesterId: 'past',
      teacherName: null,
      nrc: null,
      state: 'COMPLETED',
    });
    expect(transaction.assistantship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          semesterId: 'past',
          courseId: 'course',
          nrc: '20001',
          courseNrc: null,
          teachingAssignmentId: null,
        }),
      }),
    );
  });
  it('rejects historical courses outside the selected career', async () => {
    transaction.academicSemester.findUnique.mockResolvedValue({
      ...assignment.semester,
      isActive: false,
      startsOn: new Date('2025-08-01'),
      endsOn: new Date('2025-12-31'),
    });
    transaction.curriculumCourse.findFirst.mockResolvedValue(null);
    await expect(
      service.register({
        ...validInput(),
        teachingAssignmentId: undefined,
        courseId: 'course',
        careerId: 'career',
        approvedOn: '2025-07-01',
        startsOn: '2025-08-01',
        endsOn: '2025-12-31',
      }),
    ).rejects.toMatchObject({ response: { code: 'COURSE_CAREER' } });
  });
  it('rejects future inactive semesters', async () => {
    transaction.academicSemester.findUnique.mockResolvedValue({
      ...assignment.semester,
      isActive: false,
      startsOn: new Date('2027-01-01'),
      endsOn: new Date('2027-06-30'),
    });
    await expect(service.register(validInput())).rejects.toMatchObject({
      response: { code: 'SEMESTER_PERIOD' },
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
    prisma.assistantship.findMany
      .mockResolvedValueOnce([{ semesterId: 'semester' }])
      .mockResolvedValueOnce([record]);
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
    const query = prisma.assistantship.findMany.mock.calls[1][0];
    expect(query.skip).toBe(0);
    expect(query.where?.teachingAssignment).toEqual({
      teacherId: 'teacher',
    });
    expect(query.where?.semesterId).toBe('semester');
    expect(query.where?.startsOn).toEqual({ lte: new Date('2026-10-04') });
    expect(query.where?.OR).toHaveLength(5);
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
  it('retrieves an assistantship by ID', async () => {
    prisma.assistantship.findUnique.mockResolvedValue(record);
    const result = await service.get('assistantship');
    expect(result.id).toBe('assistantship');
    expect(result.assistantName).toBe('Estudiante');
  });

  it('throws NotFoundException when an assistantship ID does not exist', async () => {
    prisma.assistantship.findUnique.mockResolvedValue(null);
    await expect(service.get('nonexistent')).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });
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
