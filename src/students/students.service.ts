import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadCurrentCourses } from '../academic/current-courses';
import {
  ImportStudentsDto,
  ListStudentsDto,
  StudentInputDto,
} from './students.dto';
import { parseStudentCsv } from './student-csv';

const currentEnrollments = {
  where: { semester: { isActive: true } },
  include: { course: true, semester: true },
  orderBy: { nrc: 'asc' },
} as const;
type Catalog = Awaited<ReturnType<typeof loadCurrentCourses>>;

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list({ page, pageSize, search, nrc }: ListStudentsDto) {
    const where: Prisma.StudentWhereInput = {
      ...(search
        ? {
            id: { in: await this.prisma.findPiiIds('Student', search) },
          }
        : {}),
      ...(nrc
        ? { enrollments: { some: { nrc, semester: { isActive: true } } } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.student.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { enrollments: currentEnrollments },
        }),
        this.prisma.student.count({ where }),
      ],
      { maxWait: 10_000, timeout: 30_000 },
    );
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async get(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { enrollments: currentEnrollments },
    });
    if (!student) throw new NotFoundException('El estudiante no existe');
    return student;
  }

  private async write<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      });
    } catch (cause: unknown) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === 'P2002')
          throw new ConflictException('El correo o la matrícula ya existen');
        if (cause.code === 'P2034')
          throw new ConflictException(
            'La carga académica cambió. Recarga e intenta nuevamente',
          );
        if (cause.code === 'P2025')
          throw new NotFoundException('El estudiante ya no existe');
        throw new BadRequestException('No fue posible guardar los estudiantes');
      }
      throw cause;
    }
  }

  private async catalog(
    tx: Prisma.TransactionClient,
    semesterId: string,
  ): Promise<Catalog> {
    const catalog = await loadCurrentCourses(tx);
    if (!catalog.semester)
      throw new BadRequestException('No existe un semestre activo');
    if (catalog.semester.id !== semesterId)
      throw new ConflictException(
        'El semestre activo cambió. Recarga antes de guardar',
      );
    return catalog;
  }

  private offerings(catalog: Catalog, nrcs: string[], line?: number) {
    const prefix = line ? `Fila ${line}: ` : '';
    const unique = [...new Set(nrcs)];
    return unique.map((nrc) => {
      const course = catalog.courses.find((item) => item.nrc === nrc);
      if (!course)
        throw new BadRequestException(
          `${prefix}el NRC ${nrc} no existe en el semestre activo`,
        );
      return course;
    });
  }

  save(input: StudentInputDto, id?: string) {
    return this.write(async (tx) => {
      if (id && !(await tx.student.findUnique({ where: { id } })))
        throw new NotFoundException('El estudiante no existe');
      if ((input.nrcs === undefined) !== (input.semesterId === undefined))
        throw new BadRequestException(
          'Indica el semestre y las asignaturas juntos',
        );
      const catalog = input.semesterId
        ? await this.catalog(tx, input.semesterId)
        : null;
      const courses = catalog
        ? this.offerings(catalog, input.nrcs ?? [])
        : null;
      const data = {
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
      };
      const student = id
        ? await tx.student.update({ where: { id }, data })
        : await tx.student.create({ data });
      if (catalog?.semester && courses) {
        await tx.studentEnrollment.deleteMany({
          where: {
            studentId: student.id,
            semesterId: catalog.semester.id,
            nrc: { notIn: courses.map(({ nrc }) => nrc) },
          },
        });
        await tx.studentEnrollment.createMany({
          data: courses.map((course) => ({
            studentId: student.id,
            semesterId: catalog.semester.id,
            courseId: course.courseId,
            nrc: course.nrc,
          })),
          skipDuplicates: true,
        });
      }
      return tx.student.findUniqueOrThrow({
        where: { id: student.id },
        include: { enrollments: currentEnrollments },
      });
    });
  }

  async importCsv(input: ImportStudentsDto) {
    const rows = parseStudentCsv(input.csv);
    return this.write(async (tx) => {
      const catalog = await this.catalog(tx, input.semesterId);
      // Validate the whole file before the first write: failures never leave partial rosters.
      const validated = rows.map((row) => ({
        ...row,
        courses: this.offerings(catalog, row.nrcs, row.line),
      }));
      const existing = await tx.student.findMany({
        where: { email: { in: rows.map(({ email }) => email) } },
        select: { id: true, email: true, name: true },
      });
      await tx.student.createMany({
        data: rows.map(({ name, email }) => ({ name, email })),
        skipDuplicates: true,
      });
      const students = await tx.student.findMany({
        where: { email: { in: rows.map(({ email }) => email) } },
        select: { id: true, email: true },
      });
      const byEmail = new Map(
        students.map((student) => [student.email, student.id]),
      );
      for (const row of validated) {
        if (!byEmail.has(row.email))
          throw new ConflictException(
            'La lista de estudiantes cambió. Reintenta la importación',
          );
        if (
          existing.some(
            (student) =>
              student.email === row.email && student.name !== row.name,
          )
        )
          await tx.student.update({
            where: { id: byEmail.get(row.email)! },
            data: { name: row.name },
          });
      }
      const links = await tx.studentEnrollment.createMany({
        data: validated.flatMap((row) =>
          row.courses.map((course) => ({
            studentId: byEmail.get(row.email)!,
            semesterId: input.semesterId,
            courseId: course.courseId,
            nrc: course.nrc,
          })),
        ),
        skipDuplicates: true,
      });
      return {
        importedStudents: rows.length,
        createdStudents: students.length - existing.length,
        addedEnrollments: links.count,
        semesterId: input.semesterId,
      };
    });
  }
}
