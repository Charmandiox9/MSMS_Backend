import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { EditorialAccessGuard } from './editorial-access.guard';
import {
  EditorialFilesService,
  parseEditorialRange,
} from './editorial-files.service';

describe('EditorialFilesService', () => {
  const file = {
    id: 'file-id',
    authorId: 'editor',
    status: 'PENDING',
    kind: 'CAPTIONS',
    language: 'ES',
    key: 'editorial/entry/file.vtt',
  };
  const video = {
    id: 'video-id',
    status: 'READY',
    kind: 'VIDEO',
    size: 100,
    key: 'editorial/entry/video.mp4',
  };
  const reader = {
    id: 'reader',
    email: '',
    displayName: '',
    roles: ['ACADEMIC_SECRETARY'],
  };
  let prisma: {
    editorialFile: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
  };
  let storage: { uploadStream: jest.Mock; downloadFile: jest.Mock };
  let guard: { canManage: jest.Mock };
  let service: EditorialFilesService;

  beforeEach(() => {
    prisma = {
      editorialFile: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
    };
    storage = { uploadStream: jest.fn(), downloadFile: jest.fn() };
    guard = { canManage: jest.fn().mockResolvedValue(false) };
    service = new EditorialFilesService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      new ConfigService({ JWT_SECRET: 'test-editorial-secret' }),
      guard as unknown as EditorialAccessGuard,
    );
  });

  it('validates a WebVTT stream before storing it and returns a ready file', async () => {
    prisma.editorialFile.findFirst.mockResolvedValue(file);
    const content = Buffer.from(
      'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHola\n',
    );
    storage.uploadStream.mockImplementation(
      async (_key: string, _type: string, body: Readable) => {
        const received = await body.toArray();
        expect(Buffer.concat(received as Buffer[])).toEqual(content);
      },
    );
    await expect(
      service.upload(
        file.id,
        'editor',
        'text/vtt; charset=utf-8',
        undefined,
        Readable.from([content]),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: 'READY', size: content.length });
    expect(prisma.editorialFile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'READY', size: content.length, duration: null },
      }),
    );
  });

  it('rejects oversized chunked data and returns its reservation to pending', async () => {
    prisma.editorialFile.findFirst.mockResolvedValue(file);
    const body = Readable.from([Buffer.alloc(256 * 1024), Buffer.from('x')]);
    await expect(
      service.upload(
        file.id,
        'editor',
        'text/vtt',
        undefined,
        body,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(storage.uploadStream).not.toHaveBeenCalled();
    expect(prisma.editorialFile.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: 'PENDING' } }),
    );
  });

  it('rejects malformed content and allows an interrupted upload to be retried', async () => {
    prisma.editorialFile.findFirst.mockResolvedValue(file);
    await expect(
      service.upload(
        file.id,
        'editor',
        'text/vtt',
        undefined,
        Readable.from([Buffer.from('WEBVTT\n\nno time')]),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(storage.uploadStream).not.toHaveBeenCalled();
    expect(prisma.editorialFile.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: 'PENDING' } }),
    );
  });

  it('requires ownership for transfers and rejects unauthorized previews', async () => {
    prisma.editorialFile.findFirst.mockResolvedValue(null);
    await expect(
      service.upload(
        file.id,
        'another-editor',
        'text/vtt',
        undefined,
        Readable.from([]),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.editorialFile.findFirst).toHaveBeenCalledWith({
      where: { id: file.id, authorId: 'another-editor' },
    });
    await expect(
      service.issueAccess(file.id, reader, true),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('binds a ticket to the reader and rechecks published visibility on each use', async () => {
    prisma.editorialFile.findFirst
      .mockResolvedValueOnce(video)
      .mockResolvedValueOnce(null);
    const { url } = await service.issueAccess(video.id, reader, false);
    const token =
      new URL(url, 'http://localhost').searchParams.get('token') ?? undefined;
    const signal = new AbortController().signal;
    await expect(
      service.download(video.id, 'another-reader', token, undefined, signal),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.download(video.id, reader.id, token, undefined, signal),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.editorialFile.findFirst).toHaveBeenLastCalledWith({
      where: {
        id: video.id,
        status: 'READY',
        revisions: { some: { publishedOf: { is: { status: 'PUBLISHED' } } } },
      },
    });
    expect(storage.downloadFile).not.toHaveBeenCalled();
  });

  it('requests the precise byte range and rejects requests outside the video', async () => {
    prisma.editorialFile.findFirst.mockResolvedValue(video);
    storage.downloadFile.mockResolvedValue({
      body: Readable.from([]),
      length: 10,
      contentRange: 'bytes 50-59/100',
    });
    const { url } = await service.issueAccess(video.id, reader, false);
    const token =
      new URL(url, 'http://localhost').searchParams.get('token') ?? undefined;
    const signal = new AbortController().signal;
    await expect(
      service.download(video.id, reader.id, token, 'bytes=50-59', signal),
    ).resolves.toMatchObject({ range: 'bytes 50-59/100', length: 10 });
    expect(storage.downloadFile).toHaveBeenCalledWith(
      video.key,
      signal,
      'bytes=50-59',
    );
    await expect(
      service.download(video.id, reader.id, token, 'bytes=100-', signal),
    ).resolves.toEqual({ unsatisfiable: true, size: 100 });
  });
});

describe('editorial video ranges', () => {
  it.each([
    ['bytes=20-', { start: 20, end: 99 }],
    ['bytes=-20', { start: 80, end: 99 }],
    ['bytes=0-200', { start: 0, end: 99 }],
    ['bytes=-0', 'unsatisfiable'],
    ['bytes=55-54', 'unsatisfiable'],
    ['bytes=0-1,5-10', 'unsatisfiable'],
  ])('interprets %s', (value, result) => {
    expect(parseEditorialRange(value, 100)).toEqual(result);
  });
});
