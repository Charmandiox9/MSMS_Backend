import { Test } from '@nestjs/testing';
import type { ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantshipsGuard } from './assistantships.guard';

describe('AssistantshipsGuard', () => {
  const findFirst = jest.fn();
  let guard: AssistantshipsGuard;
  const context = (user?: { id: string }) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;
  beforeEach(async () => {
    findFirst.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        AssistantshipsGuard,
        { provide: PrismaService, useValue: { user: { findFirst } } },
      ],
    }).compile();
    guard = module.get(AssistantshipsGuard);
  });
  it('rejects unauthenticated requests without querying permissions', async () => {
    await expect(guard.canActivate(context())).rejects.toMatchObject({
      status: 401,
    });
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('rejects users without the required permission', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      guard.canActivate(context({ id: 'user' })),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('checks active accounts and database permissions, regardless of role names', async () => {
    findFirst.mockResolvedValue({ id: 'user' });
    expect(await guard.canActivate(context({ id: 'user' }))).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'user',
        isActive: true,
        userRoles: {
          some: {
            role: {
              permissions: {
                some: { permission: { code: 'TEACHING_ASSISTANTS_MANAGE' } },
              },
            },
          },
        },
      },
      select: { id: true },
    });
  });
});
