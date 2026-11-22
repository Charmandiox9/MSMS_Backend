import type { ExecutionContext } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import {
  EditorialAccessGuard,
  EDITORIAL_PERMISSION,
} from './editorial-access.guard';

describe('editorial authorizations', () => {
  const findFirst = jest.fn();
  const guard = new EditorialAccessGuard({
    user: { findFirst },
  } as unknown as PrismaService);

  function context(roles?: string[], header?: string) {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          user: roles ? { id: 'editor', roles } : undefined,
          get: () => header,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('requires an authenticated user and an explicit active role for multiple roles', async () => {
    await expect(guard.canActivate(context())).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      guard.canActivate(context(['SYSTEM_ADMIN', 'ACADEMIC_SECRETARY'])),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('checks assignment and permission on the selected role in the database', async () => {
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'editor' });
    const roles = ['SYSTEM_ADMIN', 'ACADEMIC_SECRETARY'];
    await expect(
      guard.canActivate(context(roles, 'ACADEMIC_SECRETARY')),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      guard.canActivate(context(roles, 'SYSTEM_ADMIN')),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenLastCalledWith({
      where: {
        id: 'editor',
        isActive: true,
        userRoles: {
          some: {
            role: {
              code: 'SYSTEM_ADMIN',
              permissions: {
                some: { permission: { code: EDITORIAL_PERMISSION } },
              },
            },
          },
        },
      },
      select: { id: true },
    });
  });
});
