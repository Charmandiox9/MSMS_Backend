import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const describeDatabase = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

// All DDL and test data live in a private schema and are rolled back, even on failure.
describeDatabase('integridad de estudiantes y matrículas en PostgreSQL', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
    const schema = `students_test_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(
      'CREATE TABLE "Course" (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE "AcademicSemester" (id TEXT PRIMARY KEY, name TEXT);',
    );
    await client.query(
      readFileSync(
        join(
          process.cwd(),
          'prisma/migrations/20261012020000_add_students_and_enrollments/migration.sql',
        ),
        'utf8',
      ),
    );
    await client.query(
      `INSERT INTO "Course" VALUES ('course-1','Biología'),('course-2','Oceanografía'); INSERT INTO "AcademicSemester" VALUES ('semester-1','2026-1'),('semester-2','2026-2'); INSERT INTO "Student" (id,name,email,"updatedAt") VALUES ('student','Ana','ana@example.test',NOW());`,
    );
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

  it('impide correos duplicados', async () => {
    await expect(
      client.query(
        `INSERT INTO "Student" (id,name,email,"updatedAt") VALUES ('duplicate','Ana','ana@example.test',NOW())`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('impide matrícula duplicada para el mismo estudiante, semestre y NRC', async () => {
    await client.query(
      `INSERT INTO "StudentEnrollment" (id,"studentId","semesterId","courseId",nrc) VALUES ('one','student','semester-1','course-1','10001')`,
    );
    await expect(
      client.query(
        `INSERT INTO "StudentEnrollment" (id,"studentId","semesterId","courseId",nrc) VALUES ('two','student','semester-1','course-2','10001')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('conserva el mismo estudiante y permite el mismo NRC en otro semestre', async () => {
    await client.query(
      `INSERT INTO "StudentEnrollment" (id,"studentId","semesterId","courseId",nrc) VALUES ('one','student','semester-1','course-1','10001'),('two','student','semester-2','course-2','10001')`,
    );
    const result = await client.query(
      `SELECT s.email,c.name,e.nrc,a.name AS semester FROM "StudentEnrollment" e JOIN "Student" s ON s.id=e."studentId" JOIN "Course" c ON c.id=e."courseId" JOIN "AcademicSemester" a ON a.id=e."semesterId" ORDER BY a.name`,
    );
    expect(result.rows).toEqual([
      {
        email: 'ana@example.test',
        name: 'Biología',
        nrc: '10001',
        semester: '2026-1',
      },
      {
        email: 'ana@example.test',
        name: 'Oceanografía',
        nrc: '10001',
        semester: '2026-2',
      },
    ]);
  });
  it('rechaza asignaturas inexistentes y conserva la integridad referencial', async () => {
    await expect(
      client.query(
        `INSERT INTO "StudentEnrollment" (id,"studentId","semesterId","courseId",nrc) VALUES ('one','student','semester-1','missing','10001')`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('procesa y consulta 1000 matrículas sin multiplicarlas por horarios o docentes', async () => {
    await client.query(
      `INSERT INTO "Student" (id,name,email,"updatedAt") SELECT 'bulk-'||n,'Estudiante '||n,'bulk-'||n||'@example.test',NOW() FROM generate_series(1,1000) n; INSERT INTO "StudentEnrollment" (id,"studentId","semesterId","courseId",nrc) SELECT 'link-'||n,'bulk-'||n,'semester-2','course-1','10001' FROM generate_series(1,1000) n;`,
    );
    const result = await client.query(
      `SELECT COUNT(*)::int AS total FROM "StudentEnrollment" WHERE "semesterId"='semester-2' AND nrc='10001'`,
    );
    expect(result.rows).toEqual([{ total: 1000 }]);
  });
});
