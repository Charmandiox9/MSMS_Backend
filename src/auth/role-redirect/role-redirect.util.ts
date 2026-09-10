import { Role } from '@prisma/client';

const NO_ACCESS_ROUTE = process.env.NO_ACCESS_ROUTE || '/sin-acceso';

// Jerarquía de prioridad: primero el rol con más prioridad. Al agregar un rol
// nuevo al enum de Prisma, hay que decidir dónde entra acá.
const ROLE_REDIRECT_PRIORITY: { role: Role; route: string }[] = [
  { role: Role.SYSTEM_ADMIN, route: '/admin' },
  { role: Role.FACULTY_ADMIN, route: '/admin' },
  { role: Role.STAFF, route: '/gestion' },
  { role: Role.VEHICLE_MANAGER, route: '/gestion' },
  { role: Role.LAB_MANAGER, route: '/gestion' },
  { role: Role.TRACKING_MANAGER, route: '/gestion' },
  { role: Role.PROFESSOR, route: '/profesor' },
  { role: Role.STUDENT, route: '/inicio' },
];

export function resolveRedirectRoute(roles: Role[]): string {
  if (!roles || roles.length === 0) {
    return NO_ACCESS_ROUTE;
  }

  const match = ROLE_REDIRECT_PRIORITY.find(({ role }) => roles.includes(role));
  return match ? match.route : NO_ACCESS_ROUTE;
}
