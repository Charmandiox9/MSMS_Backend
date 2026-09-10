const NO_ACCESS_ROUTE = process.env.NO_ACCESS_ROUTE || '/sin-acceso';

// Los códigos corresponden al catálogo RBAC persistido en Prisma. La primera
// coincidencia define la ruta de entrada de un usuario con múltiples roles.
const ROLE_REDIRECT_PRIORITY: { role: string; route: string }[] = [
  { role: 'SYSTEM_ADMIN', route: '/admin' },
  { role: 'ACADEMIC_SECRETARY', route: '/gestion' },
  { role: 'ACADEMIC_PROCESS_ANALYST', route: '/reportes' },
  { role: 'TEACHING_SUPPORT_COORDINATOR', route: '/gestion' },
  // Compatibilidad con códigos de la versión enum anterior.
  { role: 'FACULTY_ADMIN', route: '/admin' },
  { role: 'STAFF', route: '/gestion' },
  { role: 'VEHICLE_MANAGER', route: '/gestion' },
  { role: 'LAB_MANAGER', route: '/gestion' },
  { role: 'TRACKING_MANAGER', route: '/gestion' },
  { role: 'PROFESSOR', route: '/profesor' },
  { role: 'STUDENT', route: '/inicio' },
];

export function resolveRedirectRoute(roles: string[]): string {
  if (!roles || roles.length === 0) {
    return NO_ACCESS_ROUTE;
  }

  const match = ROLE_REDIRECT_PRIORITY.find(({ role }) => roles.includes(role));
  return match ? match.route : NO_ACCESS_ROUTE;
}
