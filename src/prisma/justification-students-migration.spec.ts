import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const describeDatabase = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

// Migration and test data are isolated from public tables and rolled back.
describeDatabase(
  'vínculos de justificaciones a estudiantes en PostgreSQL',
  () => {
    let client: Client;
    beforeAll(async () => {
      client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
      await client.connect();
      await client.query('BEGIN');
      const schema = `justification_students_${randomUUID().replaceAll('-', '')}`;
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      await client.query(`
      CREATE TABLE "Student" (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE);
      CREATE TABLE "JustificationInbox" (id TEXT PRIMARY KEY, "studentEmail" TEXT, "evidenceKey" TEXT);
      CREATE TABLE "Justification" (id TEXT PRIMARY KEY, "studentEmail" TEXT, "evidenceKey" TEXT);
      INSERT INTO "Student" VALUES ('student','Ana Soto','ana@example.test');
      INSERT INTO "JustificationInbox" VALUES ('legacy','old@example.test','evidence.pdf');
      INSERT INTO "Justification" VALUES ('legacy','old@example.test','evidence.pdf');
    `);
      await client.query(
        readFileSync(
          join(
            process.cwd(),
            'prisma/migrations/20261013040000_link_justifications_to_students/migration.sql',
          ),
          'utf8',
        ),
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

    it.each(['JustificationInbox', 'Justification'])(
      'conserva registros previos de %s sin exigir estudiante',
      async (table) => {
        const result = await client.query(
          `SELECT * FROM "${table}" WHERE id='legacy'`,
        );
        expect(result.rows).toEqual([
          {
            id: 'legacy',
            studentEmail: 'old@example.test',
            evidenceKey: 'evidence.pdf',
            studentId: null,
          },
        ]);
      },
    );
    it.each(['JustificationInbox', 'Justification'])(
      'rechaza estudiantes inexistentes en %s',
      async (table) => {
        await expect(
          client.query(
            `UPDATE "${table}" SET "studentId"='missing' WHERE id='legacy'`,
          ),
        ).rejects.toMatchObject({ code: '23503' });
      },
    );
    it('consulta los datos asociados y conserva el vínculo después de cambiar el correo', async () => {
      await client.query(
        `UPDATE "JustificationInbox" SET "studentId"='student'; UPDATE "Justification" SET "studentId"='student'; UPDATE "Student" SET email='nuevo@example.test';`,
      );
      const result = await client.query(
        `SELECT j."studentEmail",s.name,s.email FROM "Justification" j JOIN "Student" s ON s.id=j."studentId"`,
      );
      expect(result.rows).toEqual([
        {
          studentEmail: 'old@example.test',
          name: 'Ana Soto',
          email: 'nuevo@example.test',
        },
      ]);
      await expect(
        client.query(`DELETE FROM "Student" WHERE id='student'`),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/^(23001|23503)$/),
      });
    });
  },
);
