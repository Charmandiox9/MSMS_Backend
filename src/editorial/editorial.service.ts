import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EditorialAction,
  EditorialFileKind,
  EditorialFileStatus,
  EditorialKind,
  EditorialStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  EditorialDraftInput,
  EditorialFilters,
  EditorialFormat,
  EditorialVersionInput,
} from './editorial.graphql';
import { validatePublication } from './editorial-publication.rules';

const revisionInclude = {
  files: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  guide: { select: { status: true } },
} satisfies Prisma.EditorialRevisionInclude;

const managedInclude = {
  draft: { include: revisionInclude },
  published: { include: revisionInclude },
} satisfies Prisma.EditorialEntryInclude;

const publishedInclude = { published: managedInclude.published };

const publishedOrder = [
  { firstPublishedAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.EditorialEntryOrderByWithRelationInput[];

@Injectable()
export class EditorialService {
  constructor(private readonly prisma: PrismaService) {}

  async publications(filters: EditorialFilters) {
    const where: Prisma.EditorialEntryWhereInput = {
      status: EditorialStatus.PUBLISHED,
      kind: filters.kind ?? undefined,
      published: { is: this.revisionFilter(filters) },
    };
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.editorialEntry.findMany({
          where,
          include: publishedInclude,
          orderBy: publishedOrder,
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
        this.prisma.editorialEntry.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items: items.map((item) => this.readerView(item)), total };
  }

  async publication(id: string) {
    const entry = await this.prisma.editorialEntry.findFirst({
      where: {
        id,
        status: EditorialStatus.PUBLISHED,
        publishedId: { not: null },
      },
      include: publishedInclude,
    });
    if (!entry) throw new NotFoundException('Publicación no disponible');
    return this.readerView(entry);
  }

  async featuredPublication() {
    const entry = await this.prisma.editorialEntry.findFirst({
      where: {
        featured: true,
        status: EditorialStatus.PUBLISHED,
        kind: EditorialKind.NEWS,
      },
      include: publishedInclude,
    });
    return entry ? this.readerView(entry) : null;
  }

  async managedEntries(filters: EditorialFilters) {
    const revision = this.revisionFilter(filters);
    const where: Prisma.EditorialEntryWhereInput = {
      kind: filters.kind ?? undefined,
      ...(Object.keys(revision).length
        ? {
            OR: [
              { draft: { is: revision } },
              { draftId: null, published: { is: revision } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.editorialEntry.findMany({
          where,
          include: managedInclude,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize,
        }),
        this.prisma.editorialEntry.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { items, total };
  }

  async managedEntry(id: string) {
    const entry = await this.prisma.editorialEntry.findUnique({
      where: { id },
      include: managedInclude,
    });
    if (!entry) throw new NotFoundException('Entrada editorial no encontrada');
    return entry;
  }

  async create(kind: EditorialKind, actorId: string) {
    return this.transaction(async (tx) => {
      const entry = await tx.editorialEntry.create({
        data: { kind, createdById: actorId },
      });
      const draft = await tx.editorialRevision.create({
        data: { entryId: entry.id, number: entry.version, authorId: actorId },
      });
      await this.recordEvent(
        tx,
        entry.id,
        entry.version,
        actorId,
        EditorialAction.CREATED,
      );
      return tx.editorialEntry.update({
        where: { id: entry.id },
        data: { draftId: draft.id },
        include: managedInclude,
      });
    });
  }

  async save(input: EditorialDraftInput, actorId: string) {
    return this.change(
      input,
      actorId,
      EditorialAction.SAVED,
      async (tx, entry) => {
        const attachedFiles = await tx.editorialFile.findMany({
          where: {
            id: { in: input.fileIds },
            entryId: entry.id,
            status: EditorialFileStatus.READY,
          },
          select: {
            id: true,
            authorId: true,
            revisions: { select: { id: true } },
          },
        });
        if (
          attachedFiles.length !== input.fileIds.length ||
          attachedFiles.some(
            (file) => file.authorId !== actorId && !file.revisions.length,
          )
        ) {
          throw new BadRequestException(
            'Selecciona archivos ya validados y disponibles para esta entrada',
          );
        }

        if (input.guideId) {
          const guide = await tx.editorialEntry.findFirst({
            where: { id: input.guideId, kind: EditorialKind.GUIDE },
            select: { id: true },
          });
          if (entry.kind !== EditorialKind.NEWS || !guide)
            throw new BadRequestException(
              'Selecciona una guía válida para esta novedad',
            );
        }

        const content = {
          authorId: actorId,
          topic: input.topic ?? null,
          titleEs: input.titleEs.trim(),
          summaryEs: input.summaryEs.trim(),
          bodyEs: input.bodyEs.trim(),
          titleEn: input.titleEn?.trim() || null,
          summaryEn: input.summaryEn?.trim() || null,
          bodyEn: input.bodyEn?.trim() || null,
          destination: input.destination ?? null,
          guideId: input.guideId ?? null,
        };
        const files = attachedFiles.map(({ id }) => ({ id }));
        if (entry.draftId) {
          await tx.editorialRevision.update({
            where: { id: entry.draftId },
            data: { ...content, files: { set: files } },
          });
          return {};
        }
        const draft = await tx.editorialRevision.create({
          data: {
            ...content,
            number: entry.version + 1,
            entryId: entry.id,
            files: { connect: files },
          },
        });
        return { draftId: draft.id };
      },
    );
  }

  async publish(input: EditorialVersionInput, actorId: string) {
    return this.change(
      input,
      actorId,
      EditorialAction.PUBLISHED,
      async (_tx, entry) => {
        const revision =
          entry.draft ??
          (entry.status === EditorialStatus.ARCHIVED ? entry.published : null);
        if (!revision)
          throw new BadRequestException(
            'Prepara un borrador antes de publicar',
          );
        validatePublication(entry.kind, revision);
        if (
          revision.guideId &&
          revision.guide?.status !== EditorialStatus.PUBLISHED
        ) {
          throw new BadRequestException('Publica primero la guía vinculada');
        }
        const now = new Date();
        return {
          status: EditorialStatus.PUBLISHED,
          publishedId: revision.id,
          draftId: null,
          firstPublishedAt: entry.firstPublishedAt ?? now,
          publishedAt: now,
        };
      },
    );
  }

  async archive(input: EditorialVersionInput, actorId: string) {
    return this.change(
      input,
      actorId,
      EditorialAction.ARCHIVED,
      async (_tx, entry) => {
        if (entry.status !== EditorialStatus.PUBLISHED)
          throw new BadRequestException(
            'Solo se pueden archivar publicaciones',
          );
        return { status: EditorialStatus.ARCHIVED, featured: false };
      },
    );
  }

  async feature(
    input: EditorialVersionInput,
    featured: boolean,
    actorId: string,
  ) {
    return this.change(
      input,
      actorId,
      featured ? EditorialAction.FEATURED : EditorialAction.UNFEATURED,
      async (tx, entry) => {
        if (
          entry.status !== EditorialStatus.PUBLISHED ||
          entry.kind !== EditorialKind.NEWS
        ) {
          throw new BadRequestException(
            'Solo se pueden destacar novedades publicadas',
          );
        }
        if (featured && !entry.featured) {
          const previous = await tx.editorialEntry.findFirst({
            where: { featured: true },
          });
          if (previous) {
            const unset = await tx.editorialEntry.update({
              where: { id: previous.id },
              data: { featured: false, version: { increment: 1 } },
            });
            await this.recordEvent(
              tx,
              unset.id,
              unset.version,
              actorId,
              EditorialAction.UNFEATURED,
            );
          }
        }
        return { featured };
      },
    );
  }

  private revisionFilter(
    filters: EditorialFilters,
  ): Prisma.EditorialRevisionWhereInput {
    const search = filters.search?.trim();
    const format = filters.format;
    return {
      ...(filters.topic ? { topic: filters.topic } : {}),
      ...(search
        ? {
            OR: (['titleEs', 'summaryEs', 'titleEn', 'summaryEn'] as const).map(
              (field) => ({
                [field]: {
                  contains: search.replace(/[\\%_]/g, '\\$&'),
                  mode: 'insensitive',
                },
              }),
            ),
          }
        : {}),
      ...(format === EditorialFormat.TEXT ? { bodyEs: { not: '' } } : {}),
      ...(format === EditorialFormat.PDF || format === EditorialFormat.VIDEO
        ? {
            files: {
              some: { kind: format, status: EditorialFileStatus.READY },
            },
          }
        : {}),
    };
  }

  private readerView(
    entry: Prisma.EditorialEntryGetPayload<{
      include: typeof publishedInclude;
    }>,
  ) {
    const published = entry.published;
    return {
      ...entry,
      published: published && {
        ...published,
        guideId:
          published.guide?.status === EditorialStatus.PUBLISHED
            ? published.guideId
            : null,
      },
    };
  }

  private async change(
    input: EditorialVersionInput,
    actorId: string,
    action: EditorialAction,
    revise: (
      tx: Prisma.TransactionClient,
      entry: Prisma.EditorialEntryGetPayload<{
        include: typeof managedInclude;
      }>,
    ) => Promise<Prisma.EditorialEntryUncheckedUpdateInput>,
  ) {
    return this.transaction(async (tx) => {
      const entry = await tx.editorialEntry.findUnique({
        where: { id: input.id },
        include: managedInclude,
      });
      if (!entry)
        throw new NotFoundException('Entrada editorial no encontrada');
      if (entry.version !== input.version) throw this.editConflict();
      const changes = await revise(tx, entry);
      const updated = await tx.editorialEntry.update({
        where: { id: entry.id, version: input.version },
        data: { ...changes, version: { increment: 1 } },
        include: managedInclude,
      });
      await this.recordEvent(tx, entry.id, updated.version, actorId, action);
      return updated;
    });
  }

  private async recordEvent(
    tx: Prisma.TransactionClient,
    entryId: string,
    version: number,
    actorId: string,
    action: EditorialAction,
  ) {
    await tx.editorialEvent.create({
      data: { entryId, version, actorId, action },
    });
  }

  private async transaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002', 'P2025'].includes(error.code)
      ) {
        throw this.editConflict();
      }
      throw error;
    }
  }

  private editConflict() {
    return new ConflictException(
      'La entrada cambió. Recarga antes de continuar',
    );
  }
}
