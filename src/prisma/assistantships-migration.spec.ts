import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

// Opt-in PostgreSQL tests. Every object and row is rolled back after the suite.
const describeDatabase = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeDatabase('assistantship database integrity', () => {
  let client: Client;

  const migration = (name: string) =>
    readFileSync(
      join(process.cwd(), 'prisma/migrations', name, 'migration.sql'),
      'utf8',
    );

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
    const schema = `assistantship_test_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query('CREATE TABLE "User" ("id" TEXT PRIMARY KEY)');
    for (const name of [
      '20260921000000_add_justifications_and_academic_assignments',
      '20260921010000_add_academic_import_constraints',
      '20260922000000_add_nrc_to_academic_and_justifications',
    ]) {
      await client.query(migration(name));
    }
    await client.query(`
      INSERT INTO "Teacher" (id, name, email, "updatedAt") VALUES ('teacher', 'Docente', 'teacher@example.test', NOW());
      INSERT INTO "Course" (id, code, name, "updatedAt") VALUES ('course', 'BIO101', 'Biología', NOW()), ('other-course', 'BIO102', 'Ecología', NOW());
      INSERT INTO "AcademicSemester" (id, name, "startsOn", "endsOn", "updatedAt") VALUES ('semester', '2026-2', '2026-08-01', '2026-12-31', NOW());
      INSERT INTO "TeachingAssignment" (id, "semesterId", "teacherId", "courseId", nrc) VALUES ('assignment', 'semester', 'teacher', 'course', '12345');
    `);
    await client.query(
      migration('20261004000000_add_teaching_assistants_and_assistantships'),
    );
    await client.query(`
      INSERT INTO "TeachingAssistant" (id, name, email, "updatedAt") VALUES ('assistant', 'Estudiante', 'student@example.test', NOW());
      INSERT INTO "AssistantCourseApproval" ("assistantId", "courseId", "approvedOn", "updatedAt") VALUES ('assistant', 'course', '2026-07-01', NOW()), ('assistant', 'other-course', '2026-07-01', NOW());
    `);
  }, 30000);

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  beforeEach(async () => {
    await client.query('SAVEPOINT test_case');
  });
  afterEach(async () => {
    await client.query('ROLLBACK TO SAVEPOINT test_case');
  });

  const insertAssistantship = (
    courseId = 'course',
    approvedOn = '2026-07-01',
    startsOn = '2026-08-01',
    endsOn: string | null = null,
    weeklyHours: number | null = 4,
  ) =>
    client.query(
      `
    INSERT INTO "Assistantship" (id, "teachingAssignmentId", "assistantId", "courseId", "approvedOn", "startsOn", "endsOn", "weeklyHours", "updatedAt")
    VALUES ('assistantship', 'assignment', 'assistant', $1, $2, $3, $4, $5, NOW())
  `,
      [courseId, approvedOn, startsOn, endsOn, weeklyHours],
    );

  it('preserves existing teachers and allows an eligible assistantship', async () => {
    await insertAssistantship();
    const result = await client.query<{
      isActive: boolean;
      joinedOn: Date | null;
    }>('SELECT "isActive", "joinedOn" FROM "Teacher"');
    expect(result.rows[0]).toEqual({ isActive: true, joinedOn: null });
  });

  it('rejects a passed course different from the assigned course', async () => {
    await expect(insertAssistantship('other-course')).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('requires a recorded approval with the same date', async () => {
    await expect(
      insertAssistantship('course', '2026-06-01'),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it.each(['2026-07-01', '2026-06-30'])(
    'rejects approval on or after the start (%s)',
    async (startsOn) => {
      await expect(
        insertAssistantship('course', '2026-07-01', startsOn),
      ).rejects.toMatchObject({ code: '23514' });
    },
  );

  it('rejects an end before the start', async () => {
    await expect(
      insertAssistantship('course', '2026-07-01', '2026-08-01', '2026-07-31'),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.each([0, -1, 169])('rejects invalid weekly hours (%s)', async (hours) => {
    await expect(
      insertAssistantship('course', '2026-07-01', '2026-08-01', null, hours),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects duplicate assistant assignments', async () => {
    await insertAssistantship();
    await expect(
      client.query(
        `INSERT INTO "Assistantship" SELECT 'duplicate', "teachingAssignmentId", "assistantId", "courseId", "approvedOn", "startsOn", "endsOn", "weeklyHours", "createdAt", "updatedAt" FROM "Assistantship"`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it.each([
    'TeachingAssistant',
    'Course',
    'Teacher',
    'AcademicSemester',
    'TeachingAssignment',
  ])('protects history when deleting %s', async (table) => {
    await insertAssistantship();
    await expect(client.query(`DELETE FROM "${table}"`)).rejects.toMatchObject({
      code: '23001',
    });
  });

  it('blocks changing an approval to after the assistantship starts', async () => {
    await insertAssistantship();
    await expect(
      client.query(
        `UPDATE "AssistantCourseApproval" SET "approvedOn" = '2026-09-01' WHERE "courseId" = 'course'`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.each([
    [0, 480, 540],
    [8, 480, 540],
    [1, -1, 540],
    [1, 480, 1441],
    [1, 540, 480],
    [1, 480, 480],
  ])('rejects invalid schedule (%s, %s, %s)', async (day, start, end) => {
    await insertAssistantship();
    await expect(
      client.query(
        `INSERT INTO "AssistantshipSchedule" (id, "assistantshipId", weekday, "startsAtMinute", "endsAtMinute", "updatedAt") VALUES ('schedule', 'assistantship', $1, $2, $3, NOW())`,
        [day, start, end],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts a schedule and removes it when its assistantship is deleted', async () => {
    await insertAssistantship();
    await client.query(
      `INSERT INTO "AssistantshipSchedule" (id, "assistantshipId", weekday, "startsAtMinute", "endsAtMinute", "updatedAt") VALUES ('schedule', 'assistantship', 1, 480, 540, NOW())`,
    );
    await client.query('DELETE FROM "Assistantship"');
    expect(
      (await client.query('SELECT * FROM "AssistantshipSchedule"')).rowCount,
    ).toBe(0);
  });
});
