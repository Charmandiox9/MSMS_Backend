-- Secretaría docente comparte la gestión académica operativa con administración,
-- sin conceder permisos de administración de usuarios ni auditoría.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."code" = 'ACADEMIC_SECRETARY'
  AND p."code" IN ('ACADEMIC_WORKLOAD_MANAGE', 'SCHEDULES_MANAGE')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
