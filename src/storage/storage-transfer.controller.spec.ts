import { Test } from '@nestjs/testing';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { StorageService } from './storage.service';
import { StorageTransferController } from './storage-transfer.controller';
import { MAX_STORAGE_UPLOAD_BYTES } from './storage-transfer-token';

describe('StorageTransferController', () => {
  let controller: StorageTransferController;
  const storage = {
    verifyTransfer: jest.fn(),
    uploadFile: jest.fn(),
    downloadFile: jest.fn(),
  };
  function response() {
    return Object.assign(new EventEmitter(), {
      writableFinished: false,
      destroyed: false,
      headersSent: false,
      setHeader: jest.fn(),
      removeHeader: jest.fn(),
      destroy: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    });
  }
  function uploadRequest(chunks: Buffer[], type = 'application/pdf') {
    return Object.assign(Readable.from(chunks), {
      get: (header: string) => (header === 'content-type' ? type : undefined),
    }) as unknown as Request;
  }
  beforeEach(async () => {
    jest.resetAllMocks();
    storage.verifyTransfer.mockReturnValue({
      key: 'uploads/a.pdf',
      contentType: 'application/pdf',
    });
    storage.uploadFile.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      controllers: [StorageTransferController],
      providers: [{ provide: StorageService, useValue: storage }],
    }).compile();
    controller = module.get(StorageTransferController);
  });
  it('validates the capability before forwarding exact bytes', async () => {
    const res = response();
    await controller.upload(
      'signed',
      uploadRequest([Buffer.from('pdf')]),
      res as unknown as Response,
    );
    expect(storage.verifyTransfer).toHaveBeenCalledWith('signed', 'upload');
    expect(storage.uploadFile).toHaveBeenCalledWith(
      'uploads/a.pdf',
      'application/pdf',
      Buffer.from('pdf'),
      expect.any(AbortSignal),
    );
    expect(res.listenerCount('close')).toBe(0);
  });
  it('rejects a chunked upload larger than the limit before writing an object', async () => {
    await expect(
      controller.upload(
        'signed',
        uploadRequest([
          Buffer.alloc(MAX_STORAGE_UPLOAD_BYTES),
          Buffer.from('overflow'),
        ]),
        response() as unknown as Response,
      ),
    ).rejects.toThrow('10 MiB');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });
  it('rejects MIME mismatch without storing a file', async () => {
    await expect(
      controller.upload(
        'signed',
        uploadRequest([Buffer.from('pdf')], 'image/png'),
        response() as unknown as Response,
      ),
    ).rejects.toThrow('tipo de archivo');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });
  it('destroys the upstream download when the client disconnects', async () => {
    const body = new Readable({ read() {} });
    storage.downloadFile.mockResolvedValue({ body, length: 100 });
    const res = response();
    await controller.download('signed', res as unknown as Response);
    res.emit('close');
    const signal = storage.downloadFile.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(body.destroyed).toBe(true);
  });
  it('does not send upstream error details to the browser', async () => {
    const body = Readable.from(['pdf']);
    storage.downloadFile.mockResolvedValue({ body, length: 3 });
    const res = response();
    const file = await controller.download(
      'signed',
      res as unknown as Response,
    );
    file.errorHandler(
      new Error('private storage details'),
      res as unknown as Response,
    );
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.end).toHaveBeenCalledWith('No se pudo obtener el archivo');
    expect(res.removeHeader).toHaveBeenCalledWith('Content-Length');
    body.destroy();
  });
});
