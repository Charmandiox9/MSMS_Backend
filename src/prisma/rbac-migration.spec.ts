import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('RBAC migration', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260906000000_implement_rbac_users_roles_permissions/migration.sql',
    ),
    'utf8',
  );

  it('seeds only the four roles defined for the MVP', () => {
    expect(migration).toContain("'SYSTEM_ADMIN'");
    expect(migration).toContain("'ACADEMIC_SECRETARY'");
    expect(migration).toContain("'ACADEMIC_PROCESS_ANALYST'");
    expect(migration).toContain("'TEACHING_SUPPORT_COORDINATOR'");
    expect(migration).not.toMatch(/'PROFESSOR'|'TEACHING_ASSISTANT'|'STUDENT'/);
  });

  it('does not materialize roles from the previous prototype', () => {
    expect(migration).not.toContain('legacy-role:');
    expect(migration).not.toContain('CROSS JOIN LATERAL');
  });
});

describe('RBAC permission matrix migration', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260906010000_seed_rbac_permission_matrix/migration.sql',
    ),
    'utf8',
  );

  it('seeds explicit authorization capabilities for the MVP', () => {
    expect(migration).toContain("'USERS_MANAGE'");
    expect(migration).toContain("'JUSTIFICATIONS_CREATE'");
    expect(migration).toContain("'REPORTS_EXPORT'");
    expect(migration).toContain("'TITULATION_MANAGE'");
  });

  it('does not give support staff automated justification processing', () => {
    expect(migration).toContain("('TEACHING_SUPPORT_COORDINATOR', 'JUSTIFICATIONS_CREATE')");
    expect(migration).not.toContain("('TEACHING_SUPPORT_COORDINATOR', 'JUSTIFICATIONS_PROCESS')");
    expect(migration).not.toContain("('TEACHING_SUPPORT_COORDINATOR', 'JUSTIFICATIONS_NOTIFY')");
  });
});
