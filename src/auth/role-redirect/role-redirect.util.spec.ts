import { resolveRedirectRoute } from './role-redirect.util';

describe('resolveRedirectRoute', () => {
  it('resuelve la ruta para los roles configurables del MVP', () => {
    expect(resolveRedirectRoute(['ACADEMIC_SECRETARY'])).toBe('/gestion');
    expect(resolveRedirectRoute(['ACADEMIC_PROCESS_ANALYST'])).toBe(
      '/reportes',
    );
    expect(resolveRedirectRoute(['SYSTEM_ADMIN'])).toBe('/admin');
  });

  it('en un usuario multi-rol, gana el rol de mayor prioridad', () => {
    expect(
      resolveRedirectRoute(['ACADEMIC_PROCESS_ANALYST', 'SYSTEM_ADMIN']),
    ).toBe('/admin');
  });

  it('un usuario sin roles cae a la ruta de sin acceso, no a la raíz', () => {
    const route = resolveRedirectRoute([]);
    expect(route).toBe('/sin-acceso');
    expect(route).not.toBe('/');
  });
});
