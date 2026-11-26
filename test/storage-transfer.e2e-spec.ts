import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { createCache } from 'cache-manager';
import request from 'supertest';
import { StorageService } from '../src/storage/storage.service';
import { MAX_STORAGE_UPLOAD_BYTES } from '../src/storage/storage-transfer-token';
import {
  createTestApp,
  FORMS_SECRET,
  FORMS_UPLOAD_SECRET,
  TestApp,
} from './support/test-app';

describe('private storage through backend (e2e)', () => {
  const secret = 'transfer-test-secret-at-least-thirty-two-characters';
  let ctx: TestApp;
  let storage: StorageService;
  let send: jest.SpyInstance;
  const bytes = Buffer.from('%PDF-1.7\nprivate evidence');
  const config = {
    STORAGE_PROVIDER: 'minio',
    STORAGE_TRANSFER_MODE: 'backend',
    S3_ENDPOINT: 'http://internal-minio:9000',
    S3_BUCKET_NAME: 'private-evidence',
    S3_ACCESS_KEY: 'test-app',
    S3_SECRET_KEY: 'test-secret',
    STORAGE_TRANSFER_SECRET: secret,
    PUBLIC_API_URL: 'https://marsys.example.test/api',
  };
  const localPath = (url: string) =>
    new URL(url).pathname + new URL(url).search;
  const http = () => request(ctx.app.getHttpServer());
  async function uploadUrl() {
    const result = await http()
      .post('/api/storage/presigned-upload/forms')
      .set('x-marsys-forms-secret', FORMS_UPLOAD_SECRET)
      .send({
        fileName: 'private.pdf',
        contentType: 'application/pdf',
        externalResponseId: 'response-1',
      })
      .expect(201);
    return result.body as { key: string; uploadUrl: string };
  }
  beforeAll(async () => {
    storage = new StorageService(new ConfigService(config), createCache());
    send = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation((command: unknown) =>
        Promise.resolve(
          command instanceof GetObjectCommand
            ? { Body: Readable.from([bytes]), ContentLength: bytes.length }
            : {},
        ),
      );
    ctx = await createTestApp({ storage });
  });
  afterAll(async () => {
    await ctx.close();
    send.mockRestore();
  });

  it('issues URLs on the public backend and sends exact bytes to the internal bucket', async () => {
    const issued = await uploadUrl();
    expect(issued.uploadUrl).toMatch(
      /^https:\/\/marsys.example.test\/api\/storage\/files\/upload\?token=/,
    );
    expect(issued.uploadUrl).not.toContain('internal-minio');
    await http()
      .put(localPath(issued.uploadUrl))
      .set('Content-Type', 'application/pdf')
      .send(bytes)
      .expect(204);
    const call = send.mock.calls.findLast(
      (args: unknown[]) => args[0] instanceof PutObjectCommand,
    );
    const command = call?.[0] as PutObjectCommand;
    expect(command.input).toMatchObject({
      Key: issued.key,
      Bucket: 'private-evidence',
      ContentType: 'application/pdf',
      Body: bytes,
      IfNoneMatch: '*',
      ContentLength: bytes.length,
    });
  });

  it('registers only an uploaded evidence authorized for the same Forms response', async () => {
    ctx.prisma.seedAssignment({
      nrc: '40001',
      activeSemester: true,
      course: { name: 'Asignatura', code: 'TEST' },
      teacher: {
        id: 'teacher',
        name: 'Docente',
        email: 'docente@example.test',
      },
    });
    const issued = await uploadUrl();
    const submission = {
      externalResponseId: 'response-1',
      studentEmail: 'student@example.test',
      absenceDate: '2026-09-23',
      nrc: '40001',
      evidenceKey: issued.key,
    };
    const register = (body = submission, secret = FORMS_SECRET) =>
      http()
        .post('/api/justifications/inbox')
        .set('x-marsys-forms-secret', secret)
        .send(body);

    await register(submission, FORMS_UPLOAD_SECRET).expect(401);
    await register({
      ...submission,
      externalResponseId: 'other-response',
    }).expect(400);
    await register().expect(400);
    await http()
      .put(localPath(issued.uploadUrl))
      .set('Content-Type', 'application/pdf')
      .send(bytes)
      .expect(204);
    send.mockImplementationOnce((command: unknown) => {
      expect(command).toBeInstanceOf(HeadObjectCommand);
      return Promise.resolve({
        ContentLength: bytes.length,
        ContentType: 'application/pdf',
      });
    });
    await register().expect(201, { received: true, duplicate: false });
    await register({
      ...submission,
      evidenceKey: 'uploads/different.pdf',
    }).expect(201, { received: true, duplicate: true });
    expect([...ctx.prisma.tables.inbox.values()]).toEqual([
      expect.objectContaining({ evidenceKey: issued.key }),
    ]);
  });
  it('keeps issuance protected by session roles or Forms secret', async () => {
    await http()
      .post('/api/storage/presigned-upload/forms')
      .send({
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        externalResponseId: 'response-1',
      })
      .expect(401);
    await http()
      .post('/api/storage/presigned-upload')
      .set('Cookie', ctx.cookieFor('analyst'))
      .send({ fileName: 'a.pdf', contentType: 'application/pdf' })
      .expect(403);
    await http()
      .post('/api/storage/presigned-upload')
      .set('Cookie', ctx.cookieFor('coordinator'))
      .send({ fileName: 'a.pdf', contentType: 'application/pdf' })
      .expect(201);
  });
  it('rejects missing, unissued and wrong-operation tokens before S3', async () => {
    const issued = await uploadUrl();
    const token = new URL(issued.uploadUrl).searchParams.get('token');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const before = send.mock.calls.length;
    for (const path of [
      '/api/storage/files/upload',
      '/api/storage/files/upload?token=invalid',
      `/api/storage/files/upload?token=${'A'.repeat(43)}`,
    ])
      await http()
        .put(path)
        .set('Content-Type', 'application/pdf')
        .send(bytes)
        .expect(401);
    await http()
      .get(localPath(issued.uploadUrl).replace('/upload?', '/download?'))
      .expect(401);
    expect(send.mock.calls).toHaveLength(before);
  });

  it.each([
    'titulation-attachments/private.pdf',
    'uploads/../titulation-attachments/private.pdf',
  ])('rejects out-of-scope evidence keys before S3 (%s)', async (key) => {
    const before = send.mock.calls.length;
    await expect(storage.createPresignedDownload(key)).rejects.toThrow(
      'Archivo no encontrado',
    );
    expect(send.mock.calls).toHaveLength(before);
  });

  it('accepts a historical evidence key with the legacy bucket prefix', async () => {
    const { downloadUrl } = await storage.createPresignedDownload(
      '/private-evidence/uploads/historical.pdf',
    );
    await http().get(localPath(downloadUrl)).expect(200);
    const call = send.mock.calls.findLast(
      ([command]: [unknown]) => command instanceof GetObjectCommand,
    );
    expect(call?.[0].input.Key).toBe('private-evidence/uploads/historical.pdf');
  });

  it('rejects expired grants before S3', async () => {
    const issued = await uploadUrl();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 301_000);
    const before = send.mock.calls.length;
    try {
      await http()
        .put(localPath(issued.uploadUrl))
        .set('Content-Type', 'application/pdf')
        .send(bytes)
        .expect(401);
      expect(send.mock.calls).toHaveLength(before);
    } finally {
      clock.mockRestore();
    }
  });
  it('rejects MIME mismatch, empty, oversized and active content uploads', async () => {
    const issued = await uploadUrl();
    const path = localPath(issued.uploadUrl);
    await http()
      .put(path)
      .set('Content-Type', 'image/png')
      .send(bytes)
      .expect(400);
    await http()
      .put(path)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.alloc(0))
      .expect(400);
    await http()
      .put(path)
      .set('Content-Type', 'application/pdf')
      .set('Content-Length', String(MAX_STORAGE_UPLOAD_BYTES + 1))
      .expect(413);
    await http()
      .post('/api/storage/presigned-upload/forms')
      .set('x-marsys-forms-secret', FORMS_UPLOAD_SECRET)
      .send({
        fileName: 'script.html',
        contentType: 'text/html',
        externalResponseId: 'response-1',
      })
      .expect(400);
  });
  it('streams private downloads without redirecting and prevents caching or inline execution', async () => {
    const url = await storage.createPresignedDownload('uploads/private.pdf');
    const result = await http().get(localPath(url.downloadUrl)).expect(200);
    expect(result.body).toEqual(bytes);
    expect(result.headers['content-disposition']).toContain('attachment');
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.headers.location).toBeUndefined();
    expect(result.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves an authorized PDF preview inline without changing the download link', async () => {
    const preview = await storage.createPresignedDownload(
      'uploads/private.pdf',
      'application/pdf',
    );
    const download = await storage.createPresignedDownload(
      'uploads/private.pdf',
    );

    await http()
      .get(localPath(preview.downloadUrl))
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
      .expect('Content-Disposition', 'inline; filename="evidence.pdf"')
      .expect('Cache-Control', 'private, no-store')
      .expect('Referrer-Policy', 'no-referrer')
      .expect('X-Content-Type-Options', 'nosniff');
    await http()
      .get(localPath(download.downloadUrl))
      .expect(200)
      .expect('Content-Disposition', 'attachment; filename="evidence.pdf"');
  });
  it('supports a public API below an existing reverse proxy prefix', async () => {
    const nested = new StorageService(
      new ConfigService({
        ...config,
        PUBLIC_API_URL: 'https://eic.example.test/marsys/api',
      }),
      createCache(),
    );
    try {
      const url = await nested.createPresignedUpload(
        'a.pdf',
        'application/pdf',
      );
      expect(new URL(url.uploadUrl).pathname).toBe(
        '/marsys/api/storage/files/upload',
      );
      expect(url.expiresIn).toBe(300);
    } finally {
      nested.onModuleDestroy();
    }
  });
  it('maps storage failures to generic HTTP errors', async () => {
    const url = await storage.createPresignedDownload('uploads/private.pdf');
    send.mockRejectedValueOnce({ name: 'NoSuchKey' });
    await http().get(localPath(url.downloadUrl)).expect(404);
    send.mockRejectedValueOnce(new Error('private endpoint and credentials'));
    const result = await http().get(localPath(url.downloadUrl)).expect(503);
    expect(JSON.stringify(result.body)).not.toContain('credentials');
  });
});
