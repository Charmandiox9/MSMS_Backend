import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
import { visibleEditorialPublication } from './editorial-visibility';

const editorialTransactionTimeoutMs = 15_000;

const audienceInclude = {
  select: { roleId: true, role: { select: { code: true } } },
} satisfies Prisma.EditorialRevision$audienceRolesArgs;

const revisionInclude = {
  files: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  audienceRoles: audienceInclude,
  guide: {
    select: {
      status: true,
      published: { select: { audienceRoles: audienceInclude } },
    },
  },
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

  async publications(filters: EditorialFilters, role?: string) {
    const where: Prisma.EditorialEntryWhereInput = {
      ...visibleEditorialPublication(role),
      kind: filters.kind ?? undefined,
      AND: { published: { is: this.revisionFilter(filters) } },
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
    return { items: items.map((item) => this.readerView(item, role)), total };
  }

  async publication(id: string, role?: string) {
    const entry = await this.prisma.editorialEntry.findFirst({
      where: {
        id,
        ...visibleEditorialPublication(role),
        publishedId: { not: null },
      },
      include: publishedInclude,
    });
    if (!entry) throw new NotFoundException('Publicación no disponible');
    return this.readerView(entry, role);
  }

  async featuredPublication(role?: string) {
    const findFeatured = (
      audienceRoles: Prisma.EditorialRevisionRoleListRelationFilter,
    ) =>
      this.prisma.editorialEntry.findFirst({
        where: {
          featured: true,
          status: EditorialStatus.PUBLISHED,
          kind: EditorialKind.NEWS,
          published: { is: { audienceRoles } },
        },
        orderBy: [{ featuredAt: 'desc' }, ...publishedOrder],
        include: publishedInclude,
      });
    const targeted = role
      ? await findFeatured({ some: { role: { code: role } } })
      : null;
    const entry = targeted ?? (await findFeatured({ none: {} }));
    return entry ? this.readerView(entry, role) : null;
  }

  roles() {
    return this.prisma.role.findMany({
      select: { code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async managedEntries(filters: EditorialFilters) {
    const revision = this.revisionFilter(filters);
    const where: Prisma.EditorialEntryWhereInput = {
      kind: filters.kind ?? undefined,
      ...(filters.publishedOnly
        ? { status: EditorialStatus.PUBLISHED, published: { is: revision } }
        : Object.keys(revision).length
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
        const roles = await this.audienceRoleIds(
          tx,
          input.roleCodes,
          (entry.draft ?? entry.published)?.audienceRoles ?? [],
        );
        if (entry.draftId) {
          const audienceRoles = roles.length
            ? {
                deleteMany: {
                  roleId: { notIn: roles.map(({ roleId }) => roleId) },
                },
                createMany: { data: roles, skipDuplicates: true },
              }
            : { deleteMany: {} };
          await tx.editorialRevision.update({
            where: { id: entry.draftId },
            data: {
              ...content,
              files: { set: files },
              ...(input.roleCodes != null ? { audienceRoles } : {}),
            },
          });
          return {};
        }
        const draft = await tx.editorialRevision.create({
          data: {
            ...content,
            number: entry.version + 1,
            entryId: entry.id,
            files: { connect: files },
            ...(roles.length
              ? { audienceRoles: { createMany: { data: roles } } }
              : {}),
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
        return {
          status: EditorialStatus.ARCHIVED,
          featured: false,
          featuredAt: null,
        };
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
      async (_tx, entry) => {
        if (
          entry.status !== EditorialStatus.PUBLISHED ||
          entry.kind !== EditorialKind.NEWS
        ) {
          throw new BadRequestException(
            'Solo se pueden destacar novedades publicadas',
          );
        }
        return { featured, featuredAt: featured ? new Date() : null };
      },
    );
  }

  private async audienceRoleIds(
    tx: Prisma.TransactionClient,
    codes: string[] | undefined,
    current: { roleId: string }[],
  ) {
    if (codes == null) return current.map(({ roleId }) => ({ roleId }));
    if (!codes.length) return [];
    const roles = await tx.role.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });
    if (roles.length !== codes.length)
      throw new BadRequestException(
        'La audiencia incluye un rol que no está en el catálogo',
      );
    return roles.map(({ id }) => ({ roleId: id }));
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
    role?: string,
  ) {
    const published = entry.published;
    const guide = published?.guide;
    const guideAudience = guide?.published?.audienceRoles;
    return {
      ...entry,
      published: published && {
        ...published,
        guideId:
          guide?.status === EditorialStatus.PUBLISHED &&
          guideAudience &&
          (!guideAudience.length ||
            guideAudience.some(({ role: option }) => option.code === role))
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
        timeout: editorialTransactionTimeoutMs,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (['P2034', 'P2002', 'P2025'].includes(error.code)) {
          throw this.editConflict();
        }
        if (error.code === 'P2028') {
          throw new ServiceUnavailableException(
            'La operación editorial no pudo completarse. Recarga la entrada y vuelve a intentarlo',
            { cause: error },
          );
        }
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
