import { UnauthorizedException } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

describe('StorageController', () => {
  const upload = {
    key: 'uploads/a.pdf',
    uploadUrl: 'https://signed.example.com',
    expiresIn: 900,
  };
  const dto = { fileName: 'a.pdf', contentType: 'application/pdf' };
  let storage: { createPresignedUpload: jest.Mock };
  let controller: StorageController;

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage = { createPresignedUpload: jest.fn().mockResolvedValue(upload) };
    controller = new StorageController(storage as unknown as StorageService);
    process.env.GOOGLE_FORMS_WEBHOOK_SECRET = 'forms-secret';
  });

  afterEach(() => {
    delete process.env.GOOGLE_FORMS_WEBHOOK_SECRET;
    jest.restoreAllMocks();
  });

  it('genera una URL de subida para usuarios autenticados', async () => {
    await expect(controller.createPresignedUpload(dto)).resolves.toBe(upload);
    expect(storage.createPresignedUpload).toHaveBeenCalledWith(
      'a.pdf',
      'application/pdf',
    );
  });

  describe('createFormsPresignedUpload', () => {
    it('acepta el secreto en el header actual o en el legado, ignorando espacios', async () => {
      await expect(
        controller.createFormsPresignedUpload('forms-secret', undefined, dto),
      ).resolves.toBe(upload);
      await expect(
        controller.createFormsPresignedUpload(undefined, ' forms-secret ', dto),
      ).resolves.toBe(upload);

      expect(storage.createPresignedUpload).toHaveBeenCalledTimes(2);
    });

    it('prioriza el header actual sobre el legado', () => {
      expect(() =>
        controller.createFormsPresignedUpload('wrong', 'forms-secret', dto),
      ).toThrow(UnauthorizedException);
    });

    it.each([
      ['sin secreto', undefined],
      ['secreto incorrecto', 'wrong'],
      ['secreto vacío', ''],
    ])('rechaza la solicitud %s', (_case, secret) => {
      expect(() =>
        controller.createFormsPresignedUpload(secret, undefined, dto),
      ).toThrow('Webhook no autorizado');
      expect(storage.createPresignedUpload).not.toHaveBeenCalled();
    });

    it('rechaza todo si el backend no tiene secreto configurado', () => {
      delete process.env.GOOGLE_FORMS_WEBHOOK_SECRET;

      expect(() =>
        controller.createFormsPresignedUpload(undefined, undefined, dto),
      ).toThrow(UnauthorizedException);
      expect(() => controller.createFormsPresignedUpload('', '', dto)).toThrow(
        UnauthorizedException,
      );
    });
  });
});
