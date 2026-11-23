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

  it('uses only the assigned role requested for reading and falls back to global content for a multi-role account without a selection', async () => {
    const reader = {
      id: 'reader',
      email: '',
      displayName: '',
      roles: ['ACADEMIC_SECRETARY', 'TEACHING_SUPPORT_COORDINATOR'],
    };
    await expect(guard.readerRole(reader)).resolves.toBeUndefined();
    findFirst
      .mockResolvedValueOnce({ id: 'reader' })
      .mockResolvedValueOnce(null);
    await expect(guard.readerRole(reader, reader.roles[1])).resolves.toBe(
      reader.roles[1],
    );
    await expect(
      guard.readerRole(reader, 'SYSTEM_ADMIN'),
    ).rejects.toMatchObject({ status: 403 });
    expect(findFirst).toHaveBeenLastCalledWith({
      where: {
        id: 'reader',
        isActive: true,
        userRoles: { some: { role: { code: 'SYSTEM_ADMIN' } } },
      },
      select: { id: true },
    });
  });
});
