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
    audienceRoles: [],
  };
  const current = {
    id,
    version: 4,
    kind: EditorialKind.NEWS,
    status: EditorialStatus.PUBLISHED,
    firstPublishedAt: new Date('2026-11-21T12:00:00Z'),
    draft: revision,
    draftId: revision.id,
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
    const tx = {
      editorialEntry,
      editorialFile,
      editorialEvent,
      editorialRevision: { update: jest.fn(), create: jest.fn() },
      role: { findMany: jest.fn() },
    };
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
    await expect(
      service.publications(filters, 'ACADEMIC_SECRETARY'),
    ).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(db.editorialEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: EditorialStatus.PUBLISHED,
          published: {
            is: {
              OR: [
                { audienceRoles: { none: {} } },
                {
                  audienceRoles: {
                    some: { role: { code: 'ACADEMIC_SECRETARY' } },
                  },
                },
              ],
            },
          },
          AND: {
            published: {
              is: {
                OR: expect.arrayContaining([
                  {
                    titleEs: { contains: '2026\\_20\\%', mode: 'insensitive' },
                  },
                ]),
              },
            },
          },
        }),
      }),
    );
  });

  it('prioritizes a highlight for the active role before trying the global audience', async () => {
    db.editorialEntry.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...current, published: revision });
    await expect(
      service.featuredPublication('ACADEMIC_SECRETARY'),
    ).resolves.toMatchObject({ id });
    expect(db.editorialEntry.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          published: {
            is: {
              audienceRoles: { some: { role: { code: 'ACADEMIC_SECRETARY' } } },
            },
          },
        }),
      }),
    );
    expect(db.editorialEntry.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          published: { is: { audienceRoles: { none: {} } } },
        }),
      }),
    );
  });

  it('only exposes a published guide link to readers in the guide audience', async () => {
    db.editorialEntry.findFirst.mockResolvedValue({
      ...current,
      published: {
        ...revision,
        guideId: 'guide',
        guide: {
          status: 'PUBLISHED',
          published: {
            audienceRoles: [{ role: { code: 'ACADEMIC_SECRETARY' } }],
          },
        },
      },
    });
    await expect(
      service.publication(id, 'ACADEMIC_SECRETARY'),
    ).resolves.toMatchObject({ published: { guideId: 'guide' } });
    await expect(
      service.publication(id, 'TEACHING_SUPPORT_COORDINATOR'),
    ).resolves.toMatchObject({ published: { guideId: null } });
  });

  it('validates audience roles against the catalog and edits only the draft', async () => {
    db.editorialFile.findMany.mockResolvedValue([]);
    const input = {
      id,
      version: 4,
      titleEs: 'Editada',
      summaryEs: '',
      bodyEs: '',
      fileIds: [],
      roleCodes: ['ACADEMIC_SECRETARY'],
    };
    db.role.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'role-id' }]);
    await expect(service.save(input, actorId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.editorialRevision.update).not.toHaveBeenCalled();
    await service.save(input, actorId);
    expect(db.editorialRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: revision.id },
        data: expect.objectContaining({
          audienceRoles: {
            deleteMany: { roleId: { notIn: ['role-id'] } },
            createMany: { data: [{ roleId: 'role-id' }], skipDuplicates: true },
          },
        }),
      }),
    );
    expect(
      db.editorialEntry.update.mock.calls[0][0].data.publishedId,
    ).toBeUndefined();
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

  it('keeps the audience on legacy saves and clears it only on explicit selection of all roles', async () => {
    db.editorialFile.findMany.mockResolvedValue([]);
    db.editorialEntry.findUnique.mockResolvedValue({
      ...current,
      draft: { ...revision, audienceRoles: [{ roleId: 'assigned-role' }] },
    });
    const input = {
      id,
      version: 4,
      titleEs: 'Edición',
      summaryEs: '',
      bodyEs: '',
      fileIds: [],
    };
    await service.save(input, actorId);
    expect(
      db.editorialRevision.update.mock.calls[0][0].data.audienceRoles,
    ).toBeUndefined();
    await service.save({ ...input, roleCodes: [] }, actorId);
    expect(
      db.editorialRevision.update.mock.calls[1][0].data.audienceRoles,
    ).toEqual({ deleteMany: {} });
  });
});
