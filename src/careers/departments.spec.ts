import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ACADEMIC_REPOSITORY_ROLES } from '../academic/repository-access';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { DepartmentsController } from './departments.controller';
import {
  DepartmentVersionDto,
  SaveDepartmentDto,
  UpdateDepartmentDto,
} from './departments.dto';
import { DepartmentsService } from './departments.service';

describe('Departments', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const updatedAt = '2026-11-19T12:00:00.000Z';
  const department = {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const service = new DepartmentsService({
    department,
  } as unknown as PrismaService);
  const controller = new DepartmentsController(service);
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('test', {
      code,
      clientVersion: '7',
    });

  beforeEach(() => jest.resetAllMocks());

  it('exposes full records with link counts and lightweight select options', async () => {
    department.findMany.mockResolvedValue([]);
    await controller.list();
    await controller.options();
    expect(department.findMany).toHaveBeenNthCalledWith(1, {
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { careers: true, projects: true, outputs: true } },
      },
    });
    expect(department.findMany).toHaveBeenNthCalledWith(2, {
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  });

  it('creates normalized fields and uses the current version for edits and deletes', async () => {
    const input = plainToInstance(SaveDepartmentDto, {
      name: ' Oceanografía ',
      code: ' oce ',
    });
    expect(await validate(input)).toHaveLength(0);
    await controller.create(input);
    expect(department.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Oceanografía', code: 'OCE', description: null },
      }),
    );
    await controller.update(id, { name: 'Oceanografía', updatedAt });
    expect(department.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id, updatedAt: new Date(updatedAt) },
        data: { name: 'Oceanografía', code: null, description: null },
      }),
    );
    await expect(controller.delete(id, { updatedAt })).resolves.toEqual({
      deleted: true,
    });
    expect(department.delete).toHaveBeenCalledWith({
      where: { id, updatedAt: new Date(updatedAt) },
    });
  });

  it('returns conflicts for duplicate, linked and stale records', async () => {
    department.create.mockRejectedValueOnce(prismaError('P2002'));
    await expect(controller.create({ name: 'Oceanografía' })).rejects.toThrow(
      ConflictException,
    );
    department.update.mockRejectedValueOnce(prismaError('P2025'));
    await expect(
      controller.update(id, { name: 'Oceanografía', updatedAt }),
    ).rejects.toThrow('Recarga');
    department.delete.mockRejectedValueOnce(prismaError('P2003'));
    await expect(controller.delete(id, { updatedAt })).rejects.toThrow(
      'vinculados',
    );
    department.delete.mockRejectedValueOnce(prismaError('P2025'));
    await expect(controller.delete(id, { updatedAt })).rejects.toThrow(
      'Recarga',
    );
  });

  it('validates required names, field lengths and version timestamps', async () => {
    const fields = plainToInstance(UpdateDepartmentDto, {
      name: '  ',
      code: 'x'.repeat(31),
      description: 'x'.repeat(501),
      updatedAt: 'invalid',
    });
    expect((await validate(fields)).map(({ property }) => property)).toEqual(
      expect.arrayContaining(['name', 'code', 'description', 'updatedAt']),
    );
    expect(
      await validate(plainToInstance(DepartmentVersionDto, {})),
    ).not.toHaveLength(0);
  });

  it('uses the career read and write permissions', () => {
    const reflector = new Reflector();
    for (const read of [controller.list, controller.options]) {
      expect(
        reflector.getAllAndOverride(ROLES_KEY, [read, DepartmentsController]),
      ).toEqual([...ACADEMIC_REPOSITORY_ROLES, 'TEACHING_SUPPORT_COORDINATOR']);
    }
    for (const write of [
      controller.create,
      controller.update,
      controller.delete,
    ]) {
      expect(
        reflector.getAllAndOverride(ROLES_KEY, [write, DepartmentsController]),
      ).toEqual(['ACADEMIC_SECRETARY']);
    }
  });
});
