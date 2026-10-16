-- Seed the MVP authorization matrix. Permission codes represent backend actions,
-- never UI visibility alone.
INSERT INTO "Permission" ("id", "code", "name", "description", "createdAt", "updatedAt") VALUES
  ('00000000-0000-0000-0000-000000000101', 'DASHBOARD_VIEW', 'Ver dashboard', 'Consultar el resumen e indicadores autorizados.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000102', 'USERS_MANAGE', 'Gestionar usuarios', 'Crear, activar, desactivar y administrar usuarios.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000103', 'ROLES_MANAGE', 'Gestionar roles', 'Asignar roles a usuarios y administrar el catálogo de roles.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000104', 'PERMISSIONS_MANAGE', 'Gestionar permisos', 'Administrar las asignaciones entre roles y permisos.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000105', 'SETTINGS_MANAGE', 'Gestionar configuraciones', 'Modificar parámetros generales del sistema.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000106', 'AUDIT_LOG_VIEW', 'Ver auditoría', 'Consultar la trazabilidad y los registros de auditoría.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000107', 'ACADEMIC_RECORDS_VIEW', 'Consultar información académica', 'Consultar docentes, asignaturas y repositorios académicos.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000108', 'ACADEMIC_RECORDS_MANAGE', 'Gestionar información académica', 'Crear y actualizar información académica y administrativa.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000109', 'JUSTIFICATIONS_VIEW', 'Consultar justificaciones', 'Consultar justificaciones de inasistencia y su historial.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000110', 'JUSTIFICATIONS_CREATE', 'Cargar justificaciones', 'Registrar justificaciones y sus evidencias.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000111', 'ACADEMIC_WORKLOAD_MANAGE', 'Gestionar carga académica', 'Administrar asignaciones de carga académica.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000112', 'SCHEDULES_MANAGE', 'Gestionar horarios', 'Administrar horarios y disponibilidad docente.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000113', 'TEACHING_ASSISTANTS_MANAGE', 'Gestionar ayudantías', 'Administrar ayudantías y su historial.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000114', 'TITULATION_VIEW', 'Consultar titulaciones', 'Consultar procesos y antecedentes de titulación.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000115', 'TITULATION_MANAGE', 'Gestionar titulaciones', 'Registrar y actualizar procesos de titulación.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000116', 'REPORTS_VIEW', 'Consultar reportes', 'Consultar reportes e indicadores consolidados.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000117', 'REPORTS_EXPORT', 'Exportar reportes', 'Exportar reportes e indicadores autorizados.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM (VALUES
  -- El administrador puede operar todas las capacidades humanas del MVP.
  ('SYSTEM_ADMIN', 'DASHBOARD_VIEW'),
  ('SYSTEM_ADMIN', 'USERS_MANAGE'),
  ('SYSTEM_ADMIN', 'ROLES_MANAGE'),
  ('SYSTEM_ADMIN', 'PERMISSIONS_MANAGE'),
  ('SYSTEM_ADMIN', 'SETTINGS_MANAGE'),
  ('SYSTEM_ADMIN', 'AUDIT_LOG_VIEW'),
  ('SYSTEM_ADMIN', 'ACADEMIC_RECORDS_VIEW'),
  ('SYSTEM_ADMIN', 'ACADEMIC_RECORDS_MANAGE'),
  ('SYSTEM_ADMIN', 'JUSTIFICATIONS_VIEW'),
  ('SYSTEM_ADMIN', 'JUSTIFICATIONS_CREATE'),
  ('SYSTEM_ADMIN', 'ACADEMIC_WORKLOAD_MANAGE'),
  ('SYSTEM_ADMIN', 'SCHEDULES_MANAGE'),
  ('SYSTEM_ADMIN', 'TEACHING_ASSISTANTS_MANAGE'),
  ('SYSTEM_ADMIN', 'TITULATION_VIEW'),
  ('SYSTEM_ADMIN', 'TITULATION_MANAGE'),
  ('SYSTEM_ADMIN', 'REPORTS_VIEW'),
  ('SYSTEM_ADMIN', 'REPORTS_EXPORT'),
  -- Secretaría docente mantiene el repositorio académico y administrativo.
  ('ACADEMIC_SECRETARY', 'DASHBOARD_VIEW'),
  ('ACADEMIC_SECRETARY', 'ACADEMIC_RECORDS_VIEW'),
  ('ACADEMIC_SECRETARY', 'ACADEMIC_RECORDS_MANAGE'),
  -- Análisis académico consulta información consolidada y genera reportes.
  ('ACADEMIC_PROCESS_ANALYST', 'DASHBOARD_VIEW'),
  ('ACADEMIC_PROCESS_ANALYST', 'ACADEMIC_RECORDS_VIEW'),
  ('ACADEMIC_PROCESS_ANALYST', 'JUSTIFICATIONS_VIEW'),
  ('ACADEMIC_PROCESS_ANALYST', 'TITULATION_VIEW'),
  ('ACADEMIC_PROCESS_ANALYST', 'REPORTS_VIEW'),
  ('ACADEMIC_PROCESS_ANALYST', 'REPORTS_EXPORT'),
  -- Apoyo docente carga justificaciones; el sistema procesa y notifica.
  ('TEACHING_SUPPORT_COORDINATOR', 'DASHBOARD_VIEW'),
  ('TEACHING_SUPPORT_COORDINATOR', 'JUSTIFICATIONS_VIEW'),
  ('TEACHING_SUPPORT_COORDINATOR', 'JUSTIFICATIONS_CREATE'),
  ('TEACHING_SUPPORT_COORDINATOR', 'ACADEMIC_RECORDS_VIEW'),
  ('TEACHING_SUPPORT_COORDINATOR', 'ACADEMIC_WORKLOAD_MANAGE'),
  ('TEACHING_SUPPORT_COORDINATOR', 'SCHEDULES_MANAGE'),
  ('TEACHING_SUPPORT_COORDINATOR', 'TEACHING_ASSISTANTS_MANAGE'),
  ('TEACHING_SUPPORT_COORDINATOR', 'TITULATION_VIEW'),
  ('TEACHING_SUPPORT_COORDINATOR', 'TITULATION_MANAGE')
) AS assignment(role_code, permission_code)
JOIN "Role" r ON r."code" = assignment.role_code
JOIN "Permission" p ON p."code" = assignment.permission_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
