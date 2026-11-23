import { Injectable } from '@nestjs/common';
import type { SystemAuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ListSystemAuditQuery } from './system-audit.dto';

const PAGE_SIZE = 20;

function isPreload(action: SystemAuditAction) {
  return action === 'PRELOAD_CREATED' || action === 'PRELOAD_CANCELLED';
}

@Injectable()
export class SystemAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list({ page, action }: ListSystemAuditQuery) {
    const where = { action };
    const [total, events] = await this.prisma.$transaction(
      [
        this.prisma.systemAuditEvent.count({ where }),
        this.prisma.systemAuditEvent.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    const userIds = new Set(events.map((event) => event.actorId));
    for (const event of events) {
      if (!isPreload(event.action)) userIds.add(event.targetId);
    }
    const users = userIds.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map(({ id, name }) => [id, name]));
    return {
      items: events.map(({ actorId, targetId, ...event }) => ({
        ...event,
        actor: { id: actorId, name: names.get(actorId) ?? null },
        target: {
          id: targetId,
          kind: isPreload(event.action)
            ? ('preload' as const)
            : ('account' as const),
          name: isPreload(event.action) ? null : (names.get(targetId) ?? null),
        },
      })),
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };
  }
}
