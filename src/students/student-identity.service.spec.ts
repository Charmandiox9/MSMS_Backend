import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { StudentIdentityService } from './student-identity.service';

const input = {
  name: 'Nombre Ficticio',
  rut: '11.111.111-1',
  email: null,
  careerId: 'career-1',
};
const existing = {
  id: 'student-1',
  rut: '11111111-1',
  email: null,
  careerId: 'career-1',
};

function setup(matches: (typeof existing)[] = []) {
  const student = {
    findMany: jest.fn().mockResolvedValue(matches),
    create: jest.fn().mockResolvedValue({ id: 'new-student' }),
    update: jest.fn().mockResolvedValue(existing),
  };
  return {
    student,
    transaction: { student } as unknown as Prisma.TransactionClient,
    service: new StudentIdentityService(),
  };
}

describe('StudentIdentityService', () => {
  it('creates a partial academic student without inventing an email', async () => {
    const { student, transaction, service } = setup();
    await expect(service.resolve(transaction, input)).resolves.toBe(
      'new-student',
    );
    expect(student.create).toHaveBeenCalledWith({
      data: { ...input, rut: '11111111-1' },
      select: { id: true },
    });
  });

  it('reuses exact protected identifiers and fills only missing data', async () => {
    const { student, transaction, service } = setup([existing]);
    await expect(
      service.resolve(transaction, { ...input, email: 'STUDENT@example.com' }),
    ).resolves.toBe(existing.id);
    expect(student.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { email: 'student@example.com' },
    });
    expect(student.create).not.toHaveBeenCalled();
  });

  it('stops when a RUT and email point to different students', async () => {
    const { student, transaction, service } = setup([
      existing,
      { ...existing, id: 'other-student' },
    ]);
    await expect(service.resolve(transaction, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(student.create).not.toHaveBeenCalled();
    expect(student.update).not.toHaveBeenCalled();
  });

  it('does not match people by name or replace the RUT of a linked student', async () => {
    const { student, transaction, service } = setup([existing]);
    await expect(
      service.resolve(
        transaction,
        { ...input, rut: '22222222-2' },
        existing.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ rut: '22222222-2' }, { id: existing.id }] },
      }),
    );
    expect(student.update).not.toHaveBeenCalled();
  });
});
