import { Role } from '@prisma/client';
import { resolveRedirectRoute } from './role-redirect.util';

describe('resolveRedirectRoute', () => {
  it('resuelve la ruta correcta para un usuario con un solo rol', () => {
    expect(resolveRedirectRoute([Role.STUDENT])).toBe('/inicio');
    expect(resolveRedirectRoute([Role.PROFESSOR])).toBe('/profesor');
    expect(resolveRedirectRoute([Role.SYSTEM_ADMIN])).toBe('/admin');
  });

  it('en un usuario multi-rol, gana el rol de mayor prioridad', () => {
    const route = resolveRedirectRoute([Role.STUDENT, Role.SYSTEM_ADMIN]);
    expect(route).toBe('/admin');
  });

  it('en un usuario multi-rol sin admin, gana el siguiente en la jerarquía', () => {
    const route = resolveRedirectRoute([Role.STUDENT, Role.PROFESSOR]);
    expect(route).toBe('/profesor');
  });

  it('un usuario sin roles cae a la ruta de sin acceso, no a la raíz', () => {
    const route = resolveRedirectRoute([]);
    expect(route).toBe('/sin-acceso');
    expect(route).not.toBe('/');
  });
});
