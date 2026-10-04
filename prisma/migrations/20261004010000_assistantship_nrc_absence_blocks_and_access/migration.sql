ALTER TABLE "Assistantship" ADD COLUMN "nrc" TEXT;
ALTER TABLE "JustificationInbox" ADD COLUMN "absenceBlocks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Justification" ADD COLUMN "absenceBlocks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

INSERT INTO "RolePermission" ("roleId", "permissionId", "assignedAt")
SELECT r.id, p.id, CURRENT_TIMESTAMP
FROM "Role" r CROSS JOIN "Permission" p
WHERE r.code = 'ACADEMIC_SECRETARY' AND p.code = 'TEACHING_ASSISTANTS_MANAGE'
ON CONFLICT DO NOTHING;
