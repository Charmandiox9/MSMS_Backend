import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const getSignedUrlMock = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>;

const r2Config = {
  STORAGE_PROVIDER: 'r2',
  R2_ACCOUNT_ID: 'account',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'evidence-bucket',
};

describe('StorageService', () => {
  let sendMock: jest.SpyInstance;

  beforeEach(() => {
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockResolvedValue('https://signed.example.com/object');
    sendMock = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createService(overrides: Record<string, string> = {}) {
    return new StorageService(new ConfigService({ ...r2Config, ...overrides }));
  }

  it('rechaza una configuración R2 incompleta', () => {
    const config = new ConfigService({
      STORAGE_PROVIDER: 'r2',
      R2_ACCOUNT_ID: 'account',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
    });

    expect(() => new StorageService(config)).toThrow(
      'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET_NAME',
    );
  });

  it('indica que R2 no está habilitado cuando el proveedor no es R2', async () => {
    const config = new ConfigService({ STORAGE_PROVIDER: 'none' });
    const service = new StorageService(config);

    await expect(
      service.createPresignedUpload('evidence.pdf', 'application/pdf'),
    ).rejects.toThrow('El almacenamiento R2 no está habilitado');
    await expect(service.createPresignedDownload('uploads/a.pdf')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  describe('createPresignedUpload', () => {
    it('genera una key única bajo uploads/ con el content type solicitado', async () => {
      const service = createService();

      const first = await service.createPresignedUpload('Certificado Médico.PDF', 'application/pdf');
      const second = await service.createPresignedUpload('Certificado Médico.PDF', 'application/pdf');

      expect(first).toEqual({
        key: expect.stringMatching(/^uploads\/[0-9a-f-]{36}\.pdf$/),
        uploadUrl: 'https://signed.example.com/object',
        expiresIn: 900,
      });
      expect(second.key).not.toBe(first.key);

      const command = getSignedUrlMock.mock.calls[0][1] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'evidence-bucket',
        Key: first.key,
        ContentType: 'application/pdf',
      });
      expect(getSignedUrlMock.mock.calls[0][2]).toEqual({ expiresIn: 900 });
    });

    it('descarta el nombre original y caracteres peligrosos de la extensión', async () => {
      const service = createService();

      const { key } = await service.createPresignedUpload('../../etc/passwd.p$h%p', 'text/plain');

      expect(key).toMatch(/^uploads\/[0-9a-f-]{36}\.php$/);
      expect(key).not.toContain('..');
      expect(key).not.toContain('passwd');
    });

    it('permite archivos sin extensión', async () => {
      const { key } = await createService().createPresignedUpload('evidencia', 'image/png');

      expect(key).toMatch(/^uploads\/[0-9a-f-]{36}$/);
    });

    it.each([
      ['60', 60],
      ['3600', 3600],
      ['0', 900],
      ['3601', 900],
      ['12.5', 900],
      ['no-numero', 900],
    ])('usa R2_PRESIGNED_URL_EXPIRES_IN=%s como %d segundos', async (configured, expected) => {
      const service = createService({ R2_PRESIGNED_URL_EXPIRES_IN: configured });

      const result = await service.createPresignedUpload('a.pdf', 'application/pdf');

      expect(result.expiresIn).toBe(expected);
      expect(getSignedUrlMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: expected });
    });
  });

  describe('createPresignedDownload', () => {
    function signedKey(): string | undefined {
      const command = getSignedUrlMock.mock.calls[0][1] as GetObjectCommand;
      expect(command).toBeInstanceOf(GetObjectCommand);
      return command.input.Key;
    }

    it('firma la key existente sin barra inicial', async () => {
      const result = await createService().createPresignedDownload('/uploads/a.pdf');

      expect(result).toEqual({ downloadUrl: 'https://signed.example.com/object', expiresIn: 900 });
      expect(sendMock).toHaveBeenCalledTimes(1);
      const head = sendMock.mock.calls[0][0] as HeadObjectCommand;
      expect(head).toBeInstanceOf(HeadObjectCommand);
      expect(head.input).toEqual({ Bucket: 'evidence-bucket', Key: 'uploads/a.pdf' });
      expect(signedKey()).toBe('uploads/a.pdf');
    });

    it('prueba la key con el prefijo del bucket si la original no existe', async () => {
      sendMock.mockRejectedValueOnce(new Error('NotFound')).mockResolvedValueOnce({});

      await createService().createPresignedDownload('uploads/a.pdf');

      expect(signedKey()).toBe('evidence-bucket/uploads/a.pdf');
    });

    it('prueba la key sin el prefijo del bucket si la original no existe', async () => {
      sendMock.mockRejectedValueOnce(new Error('NotFound')).mockResolvedValueOnce({});

      await createService().createPresignedDownload('evidence-bucket/uploads/a.pdf');

      expect(signedKey()).toBe('uploads/a.pdf');
    });

    it('firma la key normalizada si ninguna variante existe', async () => {
      sendMock.mockRejectedValue(new Error('NotFound'));

      await createService().createPresignedDownload('uploads/missing.pdf');

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(signedKey()).toBe('uploads/missing.pdf');
    });
  });
});
