import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicService } from './academic.service';

describe('AcademicService', () => {
  let service: AcademicService;

  const prisma = {
    assistantship: { findMany: jest.fn().mockResolvedValue([]) },
    academicSemester: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    teacher: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
    course: { upsert: jest.fn() },
    teachingAssignment: { findFirst: jest.fn(), upsert: jest.fn() },
    courseSchedule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((operation: (client: unknown) => Promise<unknown>) =>
      operation(prisma),
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AcademicService(prisma as unknown as PrismaService);
  });

  describe('activateSemester', () => {
    it('activa el semestre indicado y desactiva los demás en una transacción', async () => {
      prisma.academicSemester.upsert.mockResolvedValue({
        id: 'sem-1',
        name: '2026-2',
      });

      const result = await service.activateSemester(
        ' 2026-2 ',
        '2026-08-01',
        '2026-12-15',
      );

      expect(result).toEqual({ id: 'sem-1', name: '2026-2' });
      expect(prisma.academicSemester.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: '2026-2' },
          create: expect.objectContaining({ name: '2026-2', isActive: true }),
        }),
      );
      expect(prisma.academicSemester.updateMany).toHaveBeenCalledWith({
        where: { id: { not: 'sem-1' } },
        data: { isActive: false },
      });
    });

    it('rechaza un rango donde el término no es posterior al inicio', async () => {
      await expect(
        service.activateSemester('2026-2', '2026-12-15', '2026-08-01'),
      ).rejects.toThrow('La fecha de término debe ser posterior al inicio');
      await expect(
        service.activateSemester('2026-2', '2026-08-01', '2026-08-01'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza fechas inválidas', async () => {
      await expect(
        service.activateSemester('2026-2', 'no-es-fecha', '2026-12-15'),
      ).rejects.toThrow('Fecha inválida: no-es-fecha');
    });
  });

  describe('importCsv', () => {
    const header =
      'teacherEmail,teacherName,courseCode,courseName,nrc,semesterName,startsOn,endsOn';

    beforeEach(() => {
      prisma.academicSemester.upsert.mockResolvedValue({ id: 'sem-1' });
      prisma.teacher.upsert.mockImplementation(
        ({ create }: { create: { email: string } }) =>
          Promise.resolve({ id: `teacher-${create.email}` }),
      );
      prisma.course.upsert.mockImplementation(
        ({ create }: { create: { code: string } }) =>
          Promise.resolve({ id: `course-${create.code}` }),
      );
    });

    it('importa filas separadas por coma o punto y coma y respeta valores entre comillas', async () => {
      const csv = [
        header,
        'ana@ucn.cl,Ana Pérez,BIO101,"Biología, Marina",10001,2026-2,2026-08-01,2026-12-15',
        'luis@ucn.cl;Luis Soto;QUI200;Química;10002;2026-2;2026-08-01;2026-12-15',
      ].join('\r\n');

      const result = await service.importCsv(csv);

      expect(result).toEqual({ semesterId: 'sem-1', importedRows: 2 });
      expect(prisma.course.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { code_name: { code: 'BIO101', name: 'Biología, Marina' } },
        }),
      );
      expect(prisma.teachingAssignment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: {
            semesterId: 'sem-1',
            teacherId: 'teacher-luis@ucn.cl',
            courseId: 'course-QUI200',
            nrc: '10002',
            parallel: '',
          },
        }),
      );
      expect(prisma.academicSemester.updateMany).toHaveBeenCalledWith({
        where: { id: { not: 'sem-1' } },
        data: { isActive: false },
      });
    });

    it('rechaza un CSV sin filas de datos', async () => {
      await expect(service.importCsv(header)).rejects.toThrow(
        'El CSV no contiene filas',
      );
    });

    it('indica la columna obligatoria que falta', async () => {
      const csv = 'teacherEmail,teacherName\nana@ucn.cl,Ana';

      await expect(service.importCsv(csv)).rejects.toThrow(
        'Falta la columna courseCode',
      );
    });

    it('rechaza filas incompletas', async () => {
      const csv = `${header}\nana@ucn.cl,,BIO101,Biología,10001,2026-2,2026-08-01,2026-12-15`;

      await expect(service.importCsv(csv)).rejects.toThrow(
        'Hay una fila incompleta en el CSV',
      );
    });

    it('rechaza fechas de semestre inválidas', async () => {
      const csv = `${header}\nana@ucn.cl,Ana,BIO101,Biología,10001,2026-2,ayer,2026-12-15`;

      await expect(service.importCsv(csv)).rejects.toThrow(
        'Fecha inválida: ayer',
      );
    });
  });

  describe('importTeacherRoster', () => {
    beforeEach(() => {
      prisma.academicSemester.findFirst.mockResolvedValue({ id: 'sem-1' });
      prisma.teacher.upsert.mockResolvedValue({ id: 'teacher-1' });
    });

    it('asigna cada NRC distinto al profesor usando la asignatura del semestre activo', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue({
        courseId: 'course-1',
      });
      const csv =
        'Nombre,Correo,NRC 1,NRC 2\nAna Pérez,ana@ucn.cl,10001|10002,10001';

      const result = await service.importTeacherRoster(csv);

      expect(result).toEqual({
        semesterId: 'sem-1',
        importedTeachers: 1,
        importedAssignments: 2,
      });
      expect(prisma.teachingAssignment.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.courseSchedule.findFirst).not.toHaveBeenCalled();
    });

    it('usa el horario cargado cuando el NRC aún no tiene asignación', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue(null);
      prisma.courseSchedule.findFirst.mockResolvedValue({
        courseId: 'course-from-schedule',
      });

      await service.importTeacherRoster('name,email,nrc\nAna,ana@ucn.cl,10001');

      expect(prisma.teachingAssignment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            courseId: 'course-from-schedule',
            nrc: '10001',
          }),
        }),
      );
    });

    it('rechaza un NRC que no existe en el semestre activo', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue(null);
      prisma.courseSchedule.findFirst.mockResolvedValue(null);

      await expect(
        service.importTeacherRoster('nombre,correo,nrc\nAna,ana@ucn.cl,99999'),
      ).rejects.toThrow('El NRC 99999 no está cargado en el semestre activo');
    });

    it('exige un semestre activo', async () => {
      prisma.academicSemester.findFirst.mockResolvedValue(null);

      await expect(
        service.importTeacherRoster('nombre,correo,nrc\nAna,ana@ucn.cl,10001'),
      ).rejects.toThrow('No existe un semestre activo');
    });

    it('exige columnas de nombre, correo y NRC', async () => {
      await expect(
        service.importTeacherRoster('nombre,nrc\nAna,10001'),
      ).rejects.toThrow(
        'El CSV debe incluir nombre, correo y al menos una columna de NRC',
      );
    });

    it('rechaza filas sin NRC', async () => {
      await expect(
        service.importTeacherRoster('nombre,correo,nrc\nAna,ana@ucn.cl,'),
      ).rejects.toThrow('Hay una fila incompleta en el CSV de profesores');
    });

    it('rechaza un CSV sin filas', async () => {
      await expect(
        service.importTeacherRoster('nombre,correo,nrc'),
      ).rejects.toThrow('El CSV de profesores no contiene filas');
    });
  });

  describe('importCourseSchedules', () => {
    beforeEach(() => {
      prisma.academicSemester.findFirst.mockResolvedValue({ id: 'sem-1' });
    });

    it('normaliza día y bloque y reutiliza la asignatura por NRC', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue({
        courseId: 'course-1',
      });
      const csv =
        'NRC,Asignatura,Día,Bloque\n10001,Biología,miércoles,c2\n10001,Biología,VIERNES,a';

      const result = await service.importCourseSchedules(csv);

      expect(result).toEqual({ semesterId: 'sem-1', importedRows: 2 });
      expect(prisma.teachingAssignment.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.courseSchedule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: {
            semesterId: 'sem-1',
            courseId: 'course-1',
            nrc: '10001',
            day: 'Miércoles',
            block: 'C2',
          },
        }),
      );
      expect(prisma.courseSchedule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ day: 'Viernes', block: 'A' }),
        }),
      );
    });

    it('crea la asignatura cuando el NRC no tiene asignación docente', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue(null);
      prisma.course.upsert.mockResolvedValue({ id: 'new-course' });

      await service.importCourseSchedules(
        'nrc,asignatura,dia,bloque\n10009,Física,lunes,B',
      );

      expect(prisma.course.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: { code: '10009', name: 'Física' } }),
      );
      expect(prisma.courseSchedule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ courseId: 'new-course' }),
        }),
      );
    });

    it('rechaza bloques fuera del catálogo', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue({
        courseId: 'course-1',
      });

      await expect(
        service.importCourseSchedules(
          'nrc,asignatura,dia,bloque\n10001,Biología,lunes,Z',
        ),
      ).rejects.toThrow('Bloque inválido: Z');
    });

    it('rechaza días inválidos, incluido el domingo', async () => {
      await expect(
        service.importCourseSchedules(
          'nrc,asignatura,dia,bloque\n10001,Biología,domingo,A',
        ),
      ).rejects.toThrow('Día inválido: domingo');
    });

    it('indica la columna obligatoria que falta', async () => {
      await expect(
        service.importCourseSchedules(
          'nrc,asignatura,dia\n10001,Biología,lunes',
        ),
      ).rejects.toThrow('Falta la columna bloque');
    });

    it('rechaza filas incompletas', async () => {
      await expect(
        service.importCourseSchedules(
          'nrc,asignatura,dia,bloque\n10001,,lunes,A',
        ),
      ).rejects.toThrow('Hay una fila incompleta en el CSV de asignaturas');
    });

    it('exige un semestre activo', async () => {
      prisma.academicSemester.findFirst.mockResolvedValue(null);

      await expect(
        service.importCourseSchedules(
          'nrc,asignatura,dia,bloque\n10001,Biología,lunes,A',
        ),
      ).rejects.toThrow('No existe un semestre activo');
    });
  });

  describe('consultas', () => {
    it('lista profesores con sus asignaciones del semestre activo', async () => {
      prisma.teacher.findMany.mockResolvedValue([]);

      await service.listTeachers();

      expect(prisma.teacher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            assignments: expect.objectContaining({
              where: { semester: { isActive: true } },
            }),
          },
        }),
      );
    });

    it('lista horarios solo del semestre activo', async () => {
      prisma.courseSchedule.findMany.mockResolvedValue([]);

      await service.listCourseSchedules();

      expect(prisma.courseSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { semester: { isActive: true } } }),
      );
    });
    it('includes assistantships in their academic block with their own NRC', async () => {
      prisma.courseSchedule.findMany.mockResolvedValue([]);
      prisma.assistantship.findMany.mockResolvedValue([
        {
          nrc: '20001',
          startsOn: new Date('2026-08-01'),
          endsOn: null,
          teachingAssignment: {
            nrc: '10001',
            course: { name: 'Biología' },
            semester: { name: '2026-2' },
          },
          approval: { assistant: { name: 'Ana', email: 'ana@example.test' } },
          schedules: [
            {
              id: 'slot',
              weekday: 1,
              startsAtMinute: 490,
              endsAtMinute: 580,
              location: 'Sala 2',
            },
          ],
        },
      ]);
      expect(await service.listCourseSchedules()).toEqual([
        expect.objectContaining({
          kind: 'ASSISTANTSHIP',
          nrc: '10001',
          assistantshipNrc: '20001',
          day: 'Lunes',
          block: 'A',
          location: 'Sala 2',
          assistant: { name: 'Ana', email: 'ana@example.test' },
        }),
      ]);
    });
  });
});
