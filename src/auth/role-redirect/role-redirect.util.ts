const NO_ACCESS_ROUTE = process.env.NO_ACCESS_ROUTE || '/no-access';

const ROLE_REDIRECT_PRIORITY: { role: string; route: string }[] = [
  { role: 'SYSTEM_ADMIN', route: '/dashboard' },
  { role: 'ACADEMIC_SECRETARY', route: '/dashboard' },
  { role: 'ACADEMIC_PROCESS_ANALYST', route: '/dashboard' },
  { role: 'TEACHING_SUPPORT_COORDINATOR', route: '/dashboard' },
  { role: 'FACULTY_ADMIN', route: '/dashboard' },
  { role: 'STAFF', route: '/dashboard' },
  { role: 'VEHICLE_MANAGER', route: '/dashboard' },
  { role: 'LAB_MANAGER', route: '/dashboard' },
  { role: 'TRACKING_MANAGER', route: '/dashboard' },
  { role: 'PROFESSOR', route: '/dashboard' },
  { role: 'STUDENT', route: '/dashboard' },
];

export function resolveRedirectRoute(roles: string[]): string {
  if (!roles || roles.length === 0) {
    return NO_ACCESS_ROUTE;
  }

  const match = ROLE_REDIRECT_PRIORITY.find(({ role }) => roles.includes(role));
  return match ? match.route : NO_ACCESS_ROUTE;
}
