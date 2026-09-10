import { ConfigService } from '@nestjs/config';
import { WhitelistService } from './whitelist.service';

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('WhitelistService', () => {
  it('permite un correo cuyo dominio está en ALLOWED_DOMAINS', () => {
    const service = new WhitelistService(
      makeConfig({ ALLOWED_DOMAINS: 'ucn.cl,alumnos.ucn.cl', ALLOWED_EMAILS: '' }),
    );

    expect(service.isEmailAllowed('estudiante@alumnos.ucn.cl')).toBe(true);
  });

  it('permite un correo excepción listado en ALLOWED_EMAILS aunque su dominio no esté permitido', () => {
    const service = new WhitelistService(
      makeConfig({
        ALLOWED_DOMAINS: 'ucn.cl',
        ALLOWED_EMAILS: 'correo1@gmail.com,correo2@outlook.com',
      }),
    );

    expect(service.isEmailAllowed('correo1@gmail.com')).toBe(true);
  });

  it('rechaza un correo que no está ni en el dominio ni en la lista de excepciones', () => {
    const service = new WhitelistService(
      makeConfig({
        ALLOWED_DOMAINS: 'ucn.cl',
        ALLOWED_EMAILS: 'correo1@gmail.com',
      }),
    );

    expect(service.isEmailAllowed('random@hotmail.com')).toBe(false);
  });

  it('compara de forma case-insensitive y hace trim', () => {
    const service = new WhitelistService(
      makeConfig({ ALLOWED_DOMAINS: ' UCN.cl ', ALLOWED_EMAILS: ' Correo1@Gmail.com ' }),
    );

    expect(service.isEmailAllowed('Estudiante@UCN.CL')).toBe(true);
    expect(service.isEmailAllowed('correo1@gmail.com')).toBe(true);
  });

  it('falla al construirse si ALLOWED_DOMAINS y ALLOWED_EMAILS están ambas vacías', () => {
    expect(
      () => new WhitelistService(makeConfig({ ALLOWED_DOMAINS: '', ALLOWED_EMAILS: '' })),
    ).toThrow();
  });

  it('falla al construirse si ambas variables no están definidas', () => {
    expect(() => new WhitelistService(makeConfig({}))).toThrow();
  });
});
