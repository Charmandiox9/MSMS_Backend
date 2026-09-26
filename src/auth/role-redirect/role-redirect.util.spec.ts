import { resolveRedirectRoute } from './role-redirect.util';

describe('resolveRedirectRoute', () => {
  it('resuelve la ruta para los roles configurables del MVP', () => {
    expect(resolveRedirectRoute(['ACADEMIC_SECRETARY'])).toBe('/dashboard');
    expect(resolveRedirectRoute(['ACADEMIC_PROCESS_ANALYST'])).toBe('/dashboard');
    expect(resolveRedirectRoute(['SYSTEM_ADMIN'])).toBe('/dashboard');
  });

  it('en un usuario multi-rol, resuelve a /dashboard', () => {
    expect(
      resolveRedirectRoute(['ACADEMIC_PROCESS_ANALYST', 'SYSTEM_ADMIN']),
    ).toBe('/dashboard');
  });

  it('un usuario sin roles cae a la ruta de sin acceso, no a la raíz', () => {
    const route = resolveRedirectRoute([]);
    expect(route).toBe('/no-access');
    expect(route).not.toBe('/');
  });
});
