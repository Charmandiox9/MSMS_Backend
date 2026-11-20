import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizePiiLookup } from '../privacy/pii-policy';

export interface StudentIdentityInput {
  name: string;
  rut?: string | null;
  email?: string | null;
  careerId?: string | null;
}

const IDENTITY_SELECT = {
  id: true,
  rut: true,
  email: true,
  careerId: true,
} satisfies Prisma.StudentSelect;

@Injectable()
export class StudentIdentityService {
  async resolve(
    transaction: Prisma.TransactionClient,
    input: StudentIdentityInput,
    linkedStudentId?: string | null,
  ): Promise<string> {
    const rut = input.rut ? normalizePiiLookup('rut', input.rut) : null;
    const email = input.email ? normalizePiiLookup('email', input.email) : null;
    const identifiers: Prisma.StudentWhereInput[] = [
      ...(rut ? [{ rut }] : []),
      ...(email ? [{ email }] : []),
      ...(linkedStudentId ? [{ id: linkedStudentId }] : []),
    ];
    const matches = identifiers.length
      ? await transaction.student.findMany({
          where: { OR: identifiers },
          select: IDENTITY_SELECT,
          take: 3,
        })
      : [];
    if (matches.length > 1)
      throw new ConflictException(
        'El RUT y el correo corresponden a fichas distintas. Revisa la ficha del alumno antes de vincular el expediente',
      );

    const student = matches[0];
    if (!student) {
      if (linkedStudentId)
        throw new ConflictException('La ficha vinculada ya no está disponible');
      const created = await transaction.student.create({
        data: {
          name: input.name.trim(),
          rut,
          email,
          careerId: input.careerId ?? null,
        },
        select: { id: true },
      });
      return created.id;
    }

    if (rut && student.rut && normalizePiiLookup('rut', student.rut) !== rut)
      throw new ConflictException(
        'El RUT no coincide con la ficha del alumno. Revisa sus antecedentes antes de guardar',
      );

    const missing: Prisma.StudentUncheckedUpdateInput = {
      ...(!student.rut && rut ? { rut } : {}),
      ...(!student.email && email ? { email } : {}),
      ...(!student.careerId && input.careerId
        ? { careerId: input.careerId }
        : {}),
    };
    if (Object.keys(missing).length)
      await transaction.student.update({
        where: { id: student.id },
        data: missing,
      });
    return student.id;
  }
}
