import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveDepartmentDto, UpdateDepartmentDto } from './departments.dto';

const departmentCounts = {
  _count: { select: { careers: true, projects: true, outputs: true } },
} satisfies Prisma.DepartmentInclude;

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: departmentCounts,
    });
  }

  options() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  create(input: SaveDepartmentDto) {
    return this.mutate(() =>
      this.prisma.department.create({
        data: this.fields(input),
        include: departmentCounts,
      }),
    );
  }

  update(id: string, input: UpdateDepartmentDto) {
    return this.mutate(() =>
      this.prisma.department.update({
        where: { id, updatedAt: new Date(input.updatedAt) },
        data: this.fields(input),
        include: departmentCounts,
      }),
    );
  }

  async delete(id: string, updatedAt: string) {
    await this.mutate(() =>
      this.prisma.department.delete({
        where: { id, updatedAt: new Date(updatedAt) },
      }),
    );
    return { deleted: true };
  }

  private fields(input: SaveDepartmentDto) {
    return {
      name: input.name,
      code: input.code?.toUpperCase() || null,
      description: input.description || null,
    };
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause: unknown) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === 'P2002')
          throw new ConflictException(
            'El nombre o código del departamento ya existe',
          );
        if (cause.code === 'P2003')
          throw new ConflictException(
            'El departamento tiene carreras, proyectos o resultados vinculados',
          );
        if (cause.code === 'P2025')
          throw new ConflictException(
            'El departamento cambió o fue eliminado. Recarga e inténtalo otra vez',
          );
      }
      throw cause;
    }
  }
}
