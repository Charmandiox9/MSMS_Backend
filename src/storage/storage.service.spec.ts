import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

describe('StorageService', () => {
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
  });
});
