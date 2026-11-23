import { EditorialStatus, type Prisma } from '@prisma/client';

export function editorialAudience(
  role?: string,
): Prisma.EditorialRevisionWhereInput {
  return {
    OR: [
      { audienceRoles: { none: {} } },
      ...(role ? [{ audienceRoles: { some: { role: { code: role } } } }] : []),
    ],
  };
}

export function visibleEditorialPublication(
  role?: string,
): Prisma.EditorialEntryWhereInput {
  return {
    status: EditorialStatus.PUBLISHED,
    published: { is: editorialAudience(role) },
  };
}
