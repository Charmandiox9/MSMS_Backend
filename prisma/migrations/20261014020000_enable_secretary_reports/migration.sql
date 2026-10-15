-- Secretaría docente puede consultar y exportar los reportes académicos autorizados.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."code" = 'ACADEMIC_SECRETARY'
  AND p."code" IN ('REPORTS_VIEW', 'REPORTS_EXPORT')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
