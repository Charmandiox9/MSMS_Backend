import { Readable } from 'node:stream';
import request from 'supertest';
import { EditorialAccessGuard } from '../src/editorial/editorial-access.guard';
import { EditorialFilesService } from '../src/editorial/editorial-files.service';
import { EditorialService } from '../src/editorial/editorial.service';
import { createTestApp, type TestApp } from './support/test-app';

describe('Novedades y guías (HTTP y GraphQL)', () => {
  let ctx: TestApp;
  const fileId = 'ab2472cf-ec0e-467c-a77d-1fa75e4b7a5c';

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await ctx?.close();
  });

  it('permite leer publicaciones con cualquier rol y exige iniciar sesión', async () => {
    const publications = jest
      .spyOn(ctx.app.get(EditorialService), 'publications')
      .mockResolvedValue({ items: [], total: 0 });
    const data = { query: '{ editorialPublications { total } }' };
    const guest = await request(ctx.app.getHttpServer())
      .post('/api/graphql')
      .send(data);
    expect(guest.body.errors[0].extensions.originalError.statusCode).toBe(401);
    expect(publications).not.toHaveBeenCalled();
    const reader = await request(ctx.app.getHttpServer())
      .post('/api/graphql')
      .set('Cookie', ctx.cookieFor('noRole'))
      .send(data);
    expect(reader.body).toEqual({
      data: { editorialPublications: { total: 0 } },
    });
  });

  it('protege las mutaciones y valida la versión antes de guardar', async () => {
    const authorization = jest.spyOn(
      ctx.app.get(EditorialAccessGuard),
      'canManage',
    );
    authorization.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const save = jest.spyOn(ctx.app.get(EditorialService), 'save');
    const data = {
      query: `mutation { saveEditorialDraft(input: { id: "${fileId}", version: 0, titleEs: "", summaryEs: "", bodyEs: "", fileIds: [] }) { id } }`,
    };
    const reader = await request(ctx.app.getHttpServer())
      .post('/api/graphql')
      .set('Cookie', ctx.cookieFor('secretary'))
      .send(data);
    expect(reader.body.errors[0].extensions.originalError.statusCode).toBe(403);
    const invalid = await request(ctx.app.getHttpServer())
      .post('/api/graphql')
      .set('Cookie', ctx.cookieFor('admin'))
      .send(data);
    expect(invalid.body.errors[0].extensions.originalError.statusCode).toBe(
      400,
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('expone una respuesta parcial para cápsulas y devuelve 416 para un rango inválido', async () => {
    const download = jest.spyOn(ctx.app.get(EditorialFilesService), 'download');
    download
      .mockResolvedValueOnce({
        unsatisfiable: false,
        file: {
          id: fileId,
          kind: 'VIDEO',
          size: 4,
          key: 'editorial/test.mp4',
          language: 'ES',
          duration: 1,
          status: 'READY',
          fileName: 'video.mp4',
          videoId: null,
          authorId: 'author',
          entryId: 'entry',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        range: 'bytes 2-3/4',
        stream: Readable.from([Buffer.from('cd')]),
        length: 2,
      })
      .mockResolvedValueOnce({ unsatisfiable: true, size: 4 });
    const path = `/api/editorial/files/${fileId}/content?token=ticket`;
    const cookie = ctx.cookieFor('coordinator');
    await request(ctx.app.getHttpServer())
      .get(path)
      .set('Cookie', cookie)
      .set('Range', 'bytes=2-3')
      .expect(206)
      .expect('Content-Range', 'bytes 2-3/4')
      .expect('Accept-Ranges', 'bytes')
      .expect('Content-Type', 'video/mp4');
    await request(ctx.app.getHttpServer())
      .get(path)
      .set('Cookie', cookie)
      .set('Range', 'bytes=5-')
      .expect(416)
      .expect('Content-Range', 'bytes */4');
    expect(download).toHaveBeenCalledWith(
      fileId,
      'user-coordinator',
      'ticket',
      'bytes=2-3',
      expect.any(AbortSignal),
    );
  });
});
