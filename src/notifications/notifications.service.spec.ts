import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const message = { to: 'student@ucn.cl', subject: 'Asunto', text: 'Cuerpo' };
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createService(values: Record<string, string>) {
    return new NotificationsService(new ConfigService(values));
  }

  it('no llama a Resend si falta la configuración', async () => {
    await expect(createService({}).send(message)).resolves.toBeUndefined();
    await expect(
      createService({ RESEND_API_KEY: 'key' }).send(message),
    ).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envía el correo a Resend con autorización y remitente configurado', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'email-1' }),
    });
    const service = createService({
      RESEND_API_KEY: 're_test',
      NOTIFICATIONS_FROM: 'MARSYS <no-reply@ucn.cl>',
    });

    await service.send(message);

    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer re_test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'MARSYS <no-reply@ucn.cl>',
        to: ['student@ucn.cl'],
        subject: 'Asunto',
        text: 'Cuerpo',
      }),
    });
  });

  it('lanza un error con el status cuando Resend rechaza el envío', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'invalid from' }),
    });
    const service = createService({
      RESEND_API_KEY: 're_test',
      NOTIFICATIONS_FROM: 'no-reply@ucn.cl',
    });

    await expect(service.send(message)).rejects.toThrow(
      'No se pudo enviar la notificación (422)',
    );
  });

  it('tolera respuestas de Resend que no son JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('bad json')),
    });
    const service = createService({
      RESEND_API_KEY: 're_test',
      NOTIFICATIONS_FROM: 'no-reply@ucn.cl',
    });

    await expect(service.send(message)).resolves.toBeUndefined();
  });
});
