import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EditorialKind, EditorialStatus, EditorialTopic } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EditorialFilters } from './editorial.graphql';
import { EditorialService } from './editorial.service';

describe('EditorialService', () => {
  const actorId = 'editor';
  const id = 'entry';
  const revision = {
    id: 'draft',
    topic: EditorialTopic.STUDENTS,
    titleEs: 'Una novedad',
    summaryEs: 'Resumen',
    bodyEs: 'Explicación',
    files: [],
  };
  const current = {
    id,
    version: 4,
    kind: EditorialKind.NEWS,
    status: EditorialStatus.PUBLISHED,
    firstPublishedAt: new Date('2026-11-21T12:00:00Z'),
    draft: revision,
  };
  let db: ReturnType<typeof database>;
  let service: EditorialService;

  function database() {
    const editorialEntry = {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    };
    const editorialFile = { findMany: jest.fn() };
    const editorialEvent = { create: jest.fn() };
    const tx = { editorialEntry, editorialFile, editorialEvent };
    return {
      ...tx,
      $transaction: jest.fn(
        (operation: ((client: typeof tx) => unknown) | Promise<unknown>[]) =>
          typeof operation === 'function'
            ? operation(tx)
            : Promise.all(operation),
      ),
    };
  }

  beforeEach(() => {
    db = database();
    db.editorialEntry.findUnique.mockResolvedValue(current);
    db.editorialEntry.update.mockResolvedValue({ ...current, version: 5 });
    service = new EditorialService(db as unknown as PrismaService);
  });

  it('publishes the new revision atomically and retains the original date', async () => {
    await service.publish({ id, version: 4 }, actorId);
    expect(db.editorialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id, version: 4 },
        data: expect.objectContaining({
          publishedId: 'draft',
          draftId: null,
          firstPublishedAt: current.firstPublishedAt,
          publishedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      }),
    );
    expect(db.editorialEvent.create).toHaveBeenCalledWith({
      data: { entryId: id, actorId, action: 'PUBLISHED', version: 5 },
    });
  });

  it('rejects an obsolete version without modifying the publication', async () => {
    await expect(
      service.publish({ id, version: 3 }, actorId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.editorialEntry.update).not.toHaveBeenCalled();
    expect(db.editorialEvent.create).not.toHaveBeenCalled();
  });

  it('requires an associated guide to be published first', async () => {
    db.editorialEntry.findUnique.mockResolvedValue({
      ...current,
      draft: {
        ...revision,
        guideId: 'guide',
        guide: { status: EditorialStatus.DRAFT },
      },
    });
    await expect(
      service.publish({ id, version: 4 }, actorId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.editorialEntry.update).not.toHaveBeenCalled();
  });

  it('hides archived details, archived related guides and all draft fields from the reader API', async () => {
    db.editorialEntry.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...current,
        published: {
          ...revision,
          guideId: 'guide',
          guide: { status: EditorialStatus.ARCHIVED },
        },
      });
    await expect(service.publication(id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.publication(id)).resolves.toMatchObject({
      published: { guideId: null },
    });
    expect(db.editorialEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: EditorialStatus.PUBLISHED }),
        include: { published: expect.any(Object) },
      }),
    );
  });

  it('searches only published revisions and escapes search wildcards', async () => {
    db.editorialEntry.findMany.mockResolvedValue([]);
    db.editorialEntry.count.mockResolvedValue(0);
    const filters = Object.assign(new EditorialFilters(), {
      search: '2026_20%',
    });
    await expect(service.publications(filters)).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(db.editorialEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: EditorialStatus.PUBLISHED,
          published: {
            is: {
              OR: expect.arrayContaining([
                { titleEs: { contains: '2026\\_20\\%', mode: 'insensitive' } },
              ]),
            },
          },
        }),
      }),
    );
  });

  it('removes the highlight when archiving and records the action', async () => {
    await service.archive({ id, version: 4 }, actorId);
    expect(db.editorialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EditorialStatus.ARCHIVED,
          featured: false,
        }),
      }),
    );
    expect(db.editorialEvent.create).toHaveBeenCalledWith({
      data: { entryId: id, actorId, action: 'ARCHIVED', version: 5 },
    });
  });
});
