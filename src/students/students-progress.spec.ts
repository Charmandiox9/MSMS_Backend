import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from './students.service';

const studentId = '11111111-1111-4111-8111-111111111111';
const courseId = '22222222-2222-4222-8222-222222222222';
const semesterId = '33333333-3333-4333-8333-333333333333';

describe('StudentsService curricular progress', () => {
  const tx = {
    student: { findUnique: jest.fn() },
    course: { findUnique: jest.fn() },
    academicSemester: { findUnique: jest.fn() },
    studentCourseAttempt: { count: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    student: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new StudentsService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (
        operation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ) => operation(tx as unknown as Prisma.TransactionClient),
    );
    tx.student.findUnique.mockResolvedValue({ id: studentId });
    tx.course.findUnique.mockResolvedValue({ id: courseId });
    tx.academicSemester.findUnique.mockResolvedValue({ id: semesterId });
    tx.studentCourseAttempt.count.mockResolvedValue(1);
    tx.studentCourseAttempt.create.mockResolvedValue({ id: 'attempt-2' });
  });

  it('numbers and retains a repeated course attempt with its result and semester', async () => {
    const result = await service.recordAttempt(studentId, {
      courseId,
      semesterId,
      outcome: 'PASSED',
      nrc: '10001',
    });

    expect(tx.studentCourseAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          studentId,
          courseId,
          semesterId,
          attemptNumber: 2,
          outcome: 'PASSED',
          nrc: '10001',
        },
      }),
    );
    expect(result).toEqual({ id: 'attempt-2' });
  });

  it('rejects an attempt when its student does not exist', async () => {
    tx.student.findUnique.mockResolvedValue(null);

    await expect(
      service.recordAttempt(studentId, {
        courseId,
        semesterId,
        outcome: 'FAILED',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.studentCourseAttempt.create).not.toHaveBeenCalled();
  });

  it('counts a course as passed while retaining every failed and passed attempt', async () => {
    prisma.student.findUnique.mockResolvedValue({
      id: studentId,
      name: 'Ana Soto',
      email: 'ana@example.com',
      careerCurriculumVersion: {
        id: 'curriculum',
        cohortYear: 2024,
        career: { id: 'career', code: 'BIO', name: 'Biología Marina' },
        courses: [
          {
            id: 'curriculum-course',
            courseId,
            termNumber: 1,
            course: { id: courseId, code: 'BM101', name: 'Biología' },
          },
        ],
      },
      courseAttempts: [
        { id: 'failed', courseId, attemptNumber: 1, outcome: 'FAILED' },
        { id: 'passed', courseId, attemptNumber: 2, outcome: 'PASSED' },
      ],
      enrollments: [],
    });

    const result = await service.progress(studentId);

    expect(result.summary).toEqual({
      totalCourses: 1,
      passedCourses: 1,
      enrolledCourses: 0,
      progressPercent: 100,
    });
    expect(result.courses[0].outcome).toBe('PASSED');
    expect(result.courses[0].attempts).toHaveLength(2);
  });

  it('marks a curriculum course enrolled from the active semester roster without counting it as passed', async () => {
    prisma.student.findUnique.mockResolvedValue({
      id: studentId,
      name: 'Ana Soto',
      email: 'ana@example.com',
      careerCurriculumVersion: {
        id: 'curriculum',
        cohortYear: 2024,
        career: { id: 'career', code: 'BIO', name: 'Biología Marina' },
        courses: [
          {
            id: 'curriculum-course',
            courseId,
            termNumber: 1,
            course: { id: courseId, code: 'BM101', name: 'Biología' },
          },
        ],
      },
      courseAttempts: [],
      enrollments: [
        { courseId, semester: { id: semesterId, name: '2026-2' } },
      ],
    });

    const result = await service.progress(studentId);

    expect(result.summary).toEqual({
      totalCourses: 1,
      passedCourses: 0,
      enrolledCourses: 1,
      progressPercent: 0,
    });
    expect(result.courses[0]).toMatchObject({
      outcome: 'PENDING',
      currentEnrollment: {
        courseId,
        semester: { id: semesterId, name: '2026-2' },
      },
    });
  });
});
