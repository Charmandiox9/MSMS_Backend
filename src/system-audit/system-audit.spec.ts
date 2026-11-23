import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { PrismaService } from '../prisma/prisma.service';
import { SystemAuditController } from './system-audit.controller';
import { ListSystemAuditQuery } from './system-audit.dto';
import { SystemAuditService } from './system-audit.service';

describe('System audit', () => {
  it('permits the administrator and denies other roles on the read endpoint', () => {
    const guard = new RolesGuard(new Reflector());
    const context = (roles: string[]) =>
      ({
        getClass: () => SystemAuditController,
        getHandler: () => SystemAuditController.prototype.list,
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
      }) as unknown as ExecutionContext;

    expect(guard.canActivate(context(['SYSTEM_ADMIN']))).toBe(true);
    expect(() => guard.canActivate(context(['ACADEMIC_SECRETARY']))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(context(['PRIVACY_OFFICER']))).toThrow(
      ForbiddenException,
    );
  });

  it('validates the action and page query and defaults to page one', async () => {
    expect(plainToInstance(ListSystemAuditQuery, {}).page).toBe(1);
    expect(
      await validate(
        plainToInstance(ListSystemAuditQuery, {
          page: '2',
          action: 'ACCOUNT_DELETED',
        }),
      ),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(ListSystemAuditQuery, {
          page: '0',
          action: 'INVALID',
        }),
      ),
    ).toHaveLength(2);
  });

  it('filters and paginates in stable descending order while keeping deleted accounts identifiable', async () => {
    const event = {
      id: 'event-1',
      action: 'ACCOUNT_DELETED',
      actorId: 'user-1',
      targetId: 'deleted-user',
      roleCodes: [],
      createdAt: new Date('2026-11-23T17:00:00Z'),
    };
    const prisma = {
      $transaction: jest.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
      systemAuditEvent: {
        count: jest.fn().mockResolvedValue(24),
        findMany: jest.fn().mockResolvedValue([event]),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'user-1', name: 'Pat Admin' }]),
      },
    };
    const service = new SystemAuditService(prisma as unknown as PrismaService);
    const controller = new SystemAuditController(service);
    await expect(
      controller.list({ page: 2, action: 'ACCOUNT_DELETED' }),
    ).resolves.toEqual({
      items: [
        {
          id: event.id,
          action: event.action,
          roleCodes: [],
          createdAt: event.createdAt,
          actor: { id: 'user-1', name: 'Pat Admin' },
          target: { id: 'deleted-user', name: null, kind: 'account' },
        },
      ],
      total: 24,
      page: 2,
      pageSize: 20,
      totalPages: 2,
    });
    expect(prisma.systemAuditEvent.findMany).toHaveBeenCalledWith({
      where: { action: 'ACCOUNT_DELETED' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 20,
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-1', 'deleted-user'] } },
      select: { id: true, name: true },
    });
  });
});
