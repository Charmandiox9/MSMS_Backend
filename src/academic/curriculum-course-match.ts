import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

function normalizedName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es');
}

export async function findCurriculumCourseMatch(
  tx: Prisma.TransactionClient,
  name: string,
  code: string | null,
): Promise<{ id: string } | null> {
  const curriculumCourses = await tx.course.findMany({
    where: { curriculumCourses: { some: {} } },
    select: { id: true, code: true, name: true },
  });
  const uniqueMatches = new Map<string, (typeof curriculumCourses)[number]>();
  for (const course of curriculumCourses) {
    if (normalizedName(course.name) === normalizedName(name))
      uniqueMatches.set(course.id, course);
  }
  const matches = [...uniqueMatches.values()];
  if (matches.length === 0) return null;

  const sameCode = matches.filter((course) => course.code === code);
  if (sameCode.length === 1) return { id: sameCode[0].id };
  if (matches.length === 1) return { id: matches[0].id };

  throw new ConflictException(
    `El nombre «${name}» coincide con varias asignaturas de mallas curriculares`,
  );
}
