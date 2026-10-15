import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicService } from './academic.service';

describe('AcademicService', () => {
  let service: AcademicService;

  const prisma = {
    findPiiIds: jest.fn().mockResolvedValue([]),
    assistantship: { findMany: jest.fn().mockResolvedValue([]) },
    academicSemester: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    teacher: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
    },
    course: {
      upsert: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'course-1' }),
    },
    teachingAssignment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    courseSchedule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((operation: (client: unknown) => Promise<unknown>) =>
      operation(prisma),
    ),
    $queryRaw: jest.fn(),
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

    it('rechaza un nombre de semestre vacío o demasiado largo', async () => {
      await expect(
        service.activateSemester('   ', '2026-08-01', '2026-12-15'),
      ).rejects.toThrow('El nombre del semestre es obligatorio');
      await expect(
        service.activateSemester('x'.repeat(101), '2026-08-01', '2026-12-15'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('updateCourse', () => {
    it('rechaza un NRC de la URL vacío o demasiado largo', async () => {
      const input = {
        name: 'Cálculo',
        nrc: '10001',
        schedules: [{ day: 'Lunes', block: 'A' }],
      };
      for (const nrc of [' ', '1'.repeat(51)])
        await expect(service.updateCourse(nrc, input)).rejects.toThrow(
          'El NRC de la asignatura no es válido',
        );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('importCsv', () => {
    const header =
      'teacherEmail,teacherName,courseCode,courseName,nrc,semesterName,startsOn,endsOn';

    it('rechaza la carga de un semestre distinto del activo sin crear docentes ni asignaturas', async () => {
      prisma.academicSemester.findFirst.mockResolvedValue({
        id: 'active',
        name: '2027-1',
      });
      const csv = `${header}\nana@ucn.cl,Ana,BIO101,Biología,10001,2026-2,2026-08-01,2026-12-15`;
      await expect(service.importCsv(csv)).rejects.toThrow(
        'La carga debe corresponder al semestre activo 2027-1',
      );
      expect(prisma.teacher.upsert).not.toHaveBeenCalled();
      expect(prisma.course.upsert).not.toHaveBeenCalled();
      expect(prisma.academicSemester.upsert).not.toHaveBeenCalled();
      expect(prisma.academicSemester.updateMany).not.toHaveBeenCalled();
    });

    it('sin semestre activo no crea ni activa uno a partir del CSV', async () => {
      prisma.academicSemester.findFirst.mockResolvedValue(null);
      const csv = `${header}\nana@ucn.cl,Ana,BIO101,Biología,10001,2026-2,2026-08-01,2026-12-15`;
      await expect(service.importCsv(csv)).rejects.toThrow(
        'No existe un semestre activo',
      );
      expect(prisma.academicSemester.upsert).not.toHaveBeenCalled();
      expect(prisma.teacher.upsert).not.toHaveBeenCalled();
    });

    beforeEach(() => {
      prisma.academicSemester.upsert.mockResolvedValue({ id: 'sem-1' });
      prisma.academicSemester.findFirst.mockResolvedValue({
        id: 'sem-1',
        name: '2026-2',
      });
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
      expect(prisma.academicSemester.findFirst).toHaveBeenCalledWith({
        where: { isActive: true },
      });
      expect(prisma.academicSemester.upsert).not.toHaveBeenCalled();
      expect(prisma.academicSemester.updateMany).not.toHaveBeenCalled();
    });

    it('rechaza un CSV sin filas de datos', async () => {
      await expect(service.importCsv(header)).rejects.toThrow(
        'El CSV no contiene filas',
      );
    });

    it('importa carga docente sin columna de código y guarda null', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue(null);
      prisma.courseSchedule.findFirst.mockResolvedValue(null);
      prisma.course.findFirst.mockResolvedValue(null);
      await service.importCsv(
        'teacherEmail;teacherName;courseName;nrc;semesterName;startsOn;endsOn\nana@ucn.cl;Ana;Biología;10001;2026-2;2026-08-01;2026-12-15',
      );
      expect(prisma.course.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { code: null, name: 'Biología' } }),
      );
      expect(prisma.course.upsert).not.toHaveBeenCalled();
    });

    it('indica la columna obligatoria que falta', async () => {
      const csv = 'teacherEmail,teacherName\nana@ucn.cl,Ana';

      await expect(service.importCsv(csv)).rejects.toThrow(
        'Falta la columna courseName',
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

    it('indica la fila del archivo donde está el error, contando la cabecera', async () => {
      const csv = [
        header,
        'ana@ucn.cl,Ana,BIO101,Biología,10001,2026-2,2026-08-01,2026-12-15',
        '',
        'luis@ucn.cl,,QUI200,Química,10002,2026-2,2026-08-01,2026-12-15',
      ].join('\n');

      await expect(service.importCsv(csv)).rejects.toThrow(
        'Fila 4: Hay una fila incompleta en el CSV',
      );
    });

    it('rechaza correos inválidos', async () => {
      const csv = `${header}\nana-ucn.cl,Ana,BIO101,Biología,10001,2026-2,2026-08-01,2026-12-15`;

      await expect(service.importCsv(csv)).rejects.toThrow(
        'Fila 2: Correo inválido: ana-ucn.cl',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('guarda los correos en minúsculas y reutiliza docentes guardados con mayúsculas', async () => {
      prisma.teacher.findFirst.mockResolvedValueOnce({ email: 'Ana@UCN.cl' });
      const csv = `${header}\nANA@ucn.cl,Ana,BIO101,Biología,10001,2026-2,2026-08-01,2026-12-15`;

      await service.importCsv(csv);

      expect(prisma.teacher.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: { equals: 'ana@ucn.cl', mode: 'insensitive' } },
        }),
      );
      expect(prisma.teacher.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'Ana@UCN.cl' },
          create: expect.objectContaining({ email: 'ana@ucn.cl' }),
        }),
      );
    });

    it('no guarda un código de funcionario vacío', async () => {
      const csv =
        'teacherEmail,teacherName,courseName,nrc,semesterName,startsOn,endsOn,employeeCode\n' +
        'ana@ucn.cl,Ana,Biología,10001,2026-2,2026-08-01,2026-12-15,';
      prisma.teachingAssignment.findFirst.mockResolvedValue(null);
      prisma.courseSchedule.findFirst.mockResolvedValue(null);

      await service.importCsv(csv);

      expect(prisma.teacher.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { name: 'Ana', employeeCode: undefined },
        }),
      );
    });

    it('exige que todas las filas sean del mismo semestre', async () => {
      const csv = [
        header,
        'ana@ucn.cl,Ana,BIO101,Biología,10001,2026-2,2026-08-01,2026-12-15',
        'luis@ucn.cl,Luis,QUI200,Química,10002,2027-1,2027-03-01,2027-07-15',
      ].join('\n');

      await expect(service.importCsv(csv)).rejects.toThrow(
        'Fila 3: Todas las filas deben ser del semestre 2026-2',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza un semestre cuyo término no es posterior al inicio', async () => {
      const csv = `${header}\nana@ucn.cl,Ana,BIO101,Biología,10001,2026-2,2026-12-15,2026-08-01`;

      await expect(service.importCsv(csv)).rejects.toThrow(
        'Fila 2: La fecha de término debe ser posterior al inicio',
      );
    });

    it('rechaza valores más largos de lo permitido', async () => {
      const csv = `${header}\nana@ucn.cl,Ana,BIO101,Biología,${'1'.repeat(51)},2026-2,2026-08-01,2026-12-15`;

      await expect(service.importCsv(csv)).rejects.toThrow(
        'Fila 2: El NRC supera los 50 caracteres',
      );
    });
  });

  describe('importTeacherRoster', () => {
    it('reutiliza el mismo profesor al importar asignaciones en otro semestre', async () => {
      prisma.teacher.findFirst.mockResolvedValue(null);
      prisma.teacher.upsert.mockResolvedValue({ id: 'persistent-teacher' });
      prisma.teachingAssignment.findFirst.mockResolvedValue({
        courseId: 'course-current',
      });
      const csv = 'nombre;correo;nrc\nAna;ana@ucn.cl;10001';
      await service.importTeacherRoster(csv);
      prisma.academicSemester.findFirst.mockResolvedValue({ id: 'sem-2' });
      await service.importTeacherRoster(csv);
      expect(
        prisma.teacher.upsert.mock.calls.map(([input]) => input.where),
      ).toEqual([{ email: 'ana@ucn.cl' }, { email: 'ana@ucn.cl' }]);
      expect(
        prisma.teachingAssignment.upsert.mock.calls.map(
          ([input]) => input.create,
        ),
      ).toEqual([
        expect.objectContaining({
          semesterId: 'sem-1',
          teacherId: 'persistent-teacher',
        }),
        expect.objectContaining({
          semesterId: 'sem-2',
          teacherId: 'persistent-teacher',
        }),
      ]);
    });
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

    it('valida el correo, lo guarda en minúsculas e indica la fila', async () => {
      await expect(
        service.importTeacherRoster(
          'nombre,correo,nrc\nAna,ana@ucn.cl,10001\nLuis,luis@,10002',
        ),
      ).rejects.toThrow('Fila 3: Correo inválido: luis@');

      prisma.teachingAssignment.findFirst.mockResolvedValue({
        courseId: 'course-1',
      });
      await service.importTeacherRoster(
        'nombre,correo,nrc\nAna,Ana@UCN.cl,10001',
      );
      expect(prisma.teacher.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { email: 'ana@ucn.cl', name: 'Ana' },
        }),
      );
    });

    it('indica la fila del NRC que no está cargado', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue(null);
      prisma.courseSchedule.findFirst.mockResolvedValue(null);

      await expect(
        service.importTeacherRoster('nombre,correo,nrc\nAna,ana@ucn.cl,99999'),
      ).rejects.toThrow('Fila 2: El NRC 99999 no está cargado');
    });
  });

  describe('importCourseSchedules', () => {
    beforeEach(() => {
      prisma.academicSemester.findFirst.mockResolvedValue({ id: 'sem-1' });
    });

    it('da a la transacción más tiempo que los 5 s por defecto de Prisma', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue({
        courseId: 'course-1',
      });

      await service.importCourseSchedules(
        'nrc,asignatura,dia,bloque\n10001,Biología,lunes,A',
      );

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ timeout: 60_000 }),
      );
    });

    it('reutiliza asignaturas sin código y conserva códigos reales al reimportar horarios', async () => {
      prisma.teachingAssignment.findFirst.mockResolvedValue(null);
      prisma.courseSchedule.findFirst.mockResolvedValue(null);
      prisma.course.findFirst.mockResolvedValue({ id: 'catalog-course' });
      await service.importCourseSchedules(
        'nrc;asignatura;dia;bloque\n10009;Física;Lunes;A',
      );
      expect(prisma.course.create).not.toHaveBeenCalled();
      expect(prisma.courseSchedule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ courseId: 'catalog-course' }),
        }),
      );
      prisma.courseSchedule.findFirst.mockResolvedValue({
        courseId: 'real-code-course',
      });
      await service.importCourseSchedules(
        'nrc;asignatura;dia;bloque\n10009;Física;Miércoles;B',
      );
      expect(prisma.courseSchedule.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ courseId: 'real-code-course' }),
        }),
      );
      prisma.course.findFirst.mockResolvedValue(null);
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
      expect(prisma.academicSemester.findFirst).toHaveBeenCalledWith({
        where: { isActive: true },
      });
      expect(prisma.teachingAssignment.findFirst).toHaveBeenCalledWith({
        where: { semesterId: 'sem-1', nrc: '10001' },
        select: { courseId: true },
      });
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
      prisma.courseSchedule.findFirst.mockResolvedValue(null);
      prisma.course.create.mockResolvedValue({ id: 'new-course' });

      await service.importCourseSchedules(
        'nrc,asignatura,dia,bloque\n10009,Física,lunes,B',
      );

      expect(prisma.course.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { code: null, name: 'Física' } }),
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

    it('valida día, bloque y largos antes de tocar la base, indicando la fila', async () => {
      await expect(
        service.importCourseSchedules(
          'nrc,asignatura,dia,bloque\n10001,Biología,lunes,A\n10001,Biología,lunes,Z',
        ),
      ).rejects.toThrow('Fila 3: Bloque inválido: Z');
      await expect(
        service.importCourseSchedules(
          `nrc,asignatura,dia,bloque,sala\n10001,Biología,lunes,A,${'x'.repeat(201)}`,
        ),
      ).rejects.toThrow('Fila 2: La sala supera los 200 caracteres');
      expect(prisma.$transaction).not.toHaveBeenCalled();
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
    const firstPage = { page: 1, pageSize: 10 };

    it('mantiene visibles los profesores sin asignaturas o sin semestre activo', async () => {
      prisma.academicSemester.findFirst.mockResolvedValue(null);
      prisma.teacher.findMany.mockResolvedValue([
        { id: 'persistent-teacher', assignments: [] },
      ]);
      prisma.teacher.count.mockResolvedValue(1);
      const result = await service.listTeachers(firstPage);
      expect(result.items).toEqual([
        { id: 'persistent-teacher', assignments: [] },
      ]);
      expect(prisma.teacher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(prisma.academicSemester.findFirst).not.toHaveBeenCalled();
    });

    it('lista profesores con sus asignaciones del semestre activo', async () => {
      prisma.teacher.findMany.mockResolvedValue([]);
      prisma.teacher.count.mockResolvedValue(0);

      await service.listTeachers(firstPage);

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

    it('pagina el listado y devuelve el total', async () => {
      prisma.teacher.findMany.mockResolvedValue([{ id: 'teacher-21' }]);
      prisma.teacher.count.mockResolvedValue(21);

      const result = await service.listTeachers({ page: 3, pageSize: 10 });

      expect(result).toEqual({
        items: [{ id: 'teacher-21' }],
        total: 21,
        page: 3,
        pageSize: 10,
        totalPages: 3,
      });
      expect(prisma.teacher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: 20, take: 10 }),
      );
      expect(prisma.teacher.count).toHaveBeenCalledWith({ where: {} });
    });

    it('busca sin tildes por nombre, correo, código y NRC del semestre activo', async () => {
      prisma.findPiiIds.mockResolvedValue(['teacher-1']);
      prisma.teacher.findMany
        .mockResolvedValueOnce([{ id: 'teacher-1' }])
        .mockResolvedValueOnce([]);
      prisma.teacher.count.mockResolvedValue(0);

      await service.listTeachers({ ...firstPage, search: 'álvaro' });

      expect(prisma.findPiiIds).toHaveBeenCalledWith('Teacher', 'álvaro');
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      const where = { id: { in: ['teacher-1'] } };
      expect(prisma.teacher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
      expect(prisma.teacher.count).toHaveBeenCalledWith({ where });
    });

    it('escapa los comodines de LIKE que escribe el usuario', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.teacher.findMany.mockResolvedValue([]);
      prisma.teacher.count.mockResolvedValue(0);

      await service.listTeachers({ ...firstPage, search: '50%_a\\b' });

      expect(prisma.findPiiIds).toHaveBeenCalledWith('Teacher', '50%_a\\b');
      expect(prisma.teacher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              {
                assignments: {
                  some: {
                    semester: { isActive: true },
                    nrc: { contains: '50\\%\\_a\\\\b', mode: 'insensitive' },
                  },
                },
              },
            ]),
          }),
        }),
      );
    });

    it('combina la búsqueda con el filtro de estado', async () => {
      prisma.findPiiIds.mockResolvedValue(['teacher-2']);
      prisma.teacher.findMany
        .mockResolvedValueOnce([{ id: 'teacher-2' }])
        .mockResolvedValueOnce([]);
      prisma.teacher.count.mockResolvedValue(0);

      await service.listTeachers({
        ...firstPage,
        search: 'soto',
        isActive: false,
      });

      expect(prisma.teacher.count).toHaveBeenCalledWith({
        where: { id: { in: ['teacher-2'] }, isActive: false },
      });
    });

    it('sin búsqueda no ejecuta la consulta SQL', async () => {
      prisma.teacher.findMany.mockResolvedValue([]);
      prisma.teacher.count.mockResolvedValue(0);

      await service.listTeachers({ ...firstPage, search: '' });

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.teacher.count).toHaveBeenCalledWith({ where: {} });
    });

    it('filtra por estado, incluido isActive=false', async () => {
      prisma.teacher.findMany.mockResolvedValue([]);
      prisma.teacher.count.mockResolvedValue(0);

      await service.listTeachers({ ...firstPage, isActive: false });

      expect(prisma.teacher.count).toHaveBeenCalledWith({
        where: { isActive: false },
      });
    });

    it('devuelve el docente solicitado', async () => {
      prisma.teacher.findUnique.mockResolvedValue({ id: 'teacher-1' });

      await expect(service.getTeacher('teacher-1')).resolves.toEqual({
        id: 'teacher-1',
      });
    });

    it('responde 404 si el docente no existe', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await expect(service.getTeacher('teacher-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    describe('getTeacherSchedule', () => {
      const teacher = { id: 'teacher-1', name: 'Ana', email: 'ana@ucn.cl' };
      const semester = { id: 'sem-1', name: '2026-2' };
      const course = (id: string) => ({
        id,
        code: `C-${id}`,
        name: `Curso ${id}`,
      });
      const row = (
        id: string,
        day: string,
        block: string,
        nrc: string,
        location: string | null = null,
      ) => ({ id, day, block, nrc, location, course: course(nrc) });

      it('responde 404 si el docente no existe', async () => {
        prisma.teacher.findUnique.mockResolvedValue(null);

        await expect(
          service.getTeacherSchedule('teacher-x'),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('devuelve los bloques y una lista vacía si no hay semestre activo', async () => {
        prisma.teacher.findUnique.mockResolvedValue(teacher);
        prisma.academicSemester.findFirst.mockResolvedValue(null);

        const result = await service.getTeacherSchedule('teacher-1');

        expect(result).toEqual(
          expect.objectContaining({ teacher, semester: null, entries: [] }),
        );
        expect(result.blocks[0]).toEqual({
          code: 'A',
          startsAt: '08:10',
          endsAt: '09:40',
        });
        expect(prisma.teachingAssignment.findMany).not.toHaveBeenCalled();
      });

      it('cruza por NRC solo dentro del semestre activo', async () => {
        prisma.teacher.findUnique.mockResolvedValue(teacher);
        prisma.academicSemester.findFirst.mockResolvedValue(semester);
        prisma.teachingAssignment.findMany.mockResolvedValue([
          { nrc: '10001' },
          { nrc: '10002' },
          { nrc: '10001' },
          { nrc: '' },
        ]);
        prisma.courseSchedule.findMany.mockResolvedValue([]);

        await service.getTeacherSchedule('teacher-1');

        expect(prisma.teachingAssignment.findMany).toHaveBeenCalledWith({
          where: { teacherId: 'teacher-1', semesterId: 'sem-1' },
          select: { nrc: true },
        });
        expect(prisma.courseSchedule.findMany).toHaveBeenCalledWith({
          where: { semesterId: 'sem-1', nrc: { in: ['10001', '10002'] } },
          include: { course: true },
        });
      });

      it('no consulta horarios si el docente no tiene NRC en el semestre', async () => {
        prisma.teacher.findUnique.mockResolvedValue(teacher);
        prisma.academicSemester.findFirst.mockResolvedValue(semester);
        prisma.teachingAssignment.findMany.mockResolvedValue([]);

        const result = await service.getTeacherSchedule('teacher-1');

        expect(result.entries).toEqual([]);
        expect(prisma.courseSchedule.findMany).not.toHaveBeenCalled();
      });

      it('ordena por día y bloque y marca los choques', async () => {
        prisma.teacher.findUnique.mockResolvedValue(teacher);
        prisma.academicSemester.findFirst.mockResolvedValue(semester);
        prisma.teachingAssignment.findMany.mockResolvedValue([
          { nrc: '10001' },
          { nrc: '10002' },
        ]);
        prisma.courseSchedule.findMany.mockResolvedValue([
          row('s1', 'Miércoles', 'C', '10001', 'Sala 1'),
          row('s2', 'Lunes', 'D', '10002'),
          row('s3', 'Lunes', 'A', '10002'),
          row('s4', 'Miércoles', 'C', '10002'),
          row('s5', 'Lunes', 'Z', '10001'),
        ]);

        const result = await service.getTeacherSchedule('teacher-1');

        expect(result.semester).toEqual(semester);
        expect(
          result.entries.map(({ id, conflict }) => [id, conflict]),
        ).toEqual([
          ['s3', false],
          ['s2', false],
          ['s5', false],
          ['s1', true],
          ['s4', true],
        ]);
        expect(result.entries[0]).toEqual({
          id: 's3',
          kind: 'COURSE',
          day: 'Lunes',
          block: 'A',
          startsAt: '08:10',
          endsAt: '09:40',
          nrc: '10002',
          assistantshipNrc: null,
          course: course('10002'),
          location: null,
          assistant: null,
          state: null,
          conflict: false,
        });
        // Un bloque desconocido se conserva, pero sin hora.
        expect(result.entries[2]).toEqual(
          expect.objectContaining({ block: 'Z', startsAt: null, endsAt: null }),
        );
        expect(result.entries[3].location).toBe('Sala 1');
      });

      const assistantship = (
        nrc: string | null,
        schedules: {
          id: string;
          weekday: number;
          startsAtMinute: number;
          endsAtMinute: number;
          location?: string | null;
        }[],
        dates: { startsOn: Date; endsOn: Date | null } = {
          startsOn: new Date('2026-08-01'),
          endsOn: null,
        },
      ) => ({
        nrc,
        ...dates,
        teachingAssignment: { nrc: '10001', course: course('10001') },
        approval: {
          assistant: { id: 'ta-1', name: 'Pedro', email: 'pedro@ucn.cl' },
        },
        schedules: schedules.map((schedule) => ({
          location: null,
          ...schedule,
        })),
      });

      it('busca las ayudantías de las asignaciones del docente en el semestre activo', async () => {
        prisma.teacher.findUnique.mockResolvedValue(teacher);
        prisma.academicSemester.findFirst.mockResolvedValue(semester);
        prisma.teachingAssignment.findMany.mockResolvedValue([]);
        prisma.assistantship.findMany.mockResolvedValue([]);

        await service.getTeacherSchedule('teacher-1');

        expect(prisma.assistantship.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              teachingAssignment: {
                teacherId: 'teacher-1',
                semesterId: 'sem-1',
              },
            },
          }),
        );
      });

      it('incluye las ayudantías con su día, bloque, hora y ayudante', async () => {
        prisma.teacher.findUnique.mockResolvedValue(teacher);
        prisma.academicSemester.findFirst.mockResolvedValue(semester);
        prisma.teachingAssignment.findMany.mockResolvedValue([
          { nrc: '10001' },
        ]);
        prisma.courseSchedule.findMany.mockResolvedValue([
          row('s1', 'Lunes', 'A', '10001'),
        ]);
        prisma.assistantship.findMany.mockResolvedValue([
          assistantship('20001', [
            // Mismo bloque que la clase: no es choque.
            { id: 'a1', weekday: 1, startsAtMinute: 490, endsAtMinute: 580 },
            // Horario que no calza con un bloque institucional.
            {
              id: 'a2',
              weekday: 2,
              startsAtMinute: 600,
              endsAtMinute: 660,
              location: 'Lab 3',
            },
            // 7 = domingo, fuera de los días del horario: va al final.
            { id: 'a3', weekday: 7, startsAtMinute: 490, endsAtMinute: 580 },
          ]),
        ]);

        const result = await service.getTeacherSchedule('teacher-1');

        expect(
          result.entries.map(({ id, kind, day, block, conflict }) => [
            id,
            kind,
            day,
            block,
            conflict,
          ]),
        ).toEqual([
          ['s1', 'COURSE', 'Lunes', 'A', false],
          ['a1', 'ASSISTANTSHIP', 'Lunes', 'A', false],
          ['a2', 'ASSISTANTSHIP', 'Martes', '', false],
          ['a3', 'ASSISTANTSHIP', 'Domingo', 'A', false],
        ]);
        expect(result.entries[2]).toEqual({
          id: 'a2',
          kind: 'ASSISTANTSHIP',
          day: 'Martes',
          block: '',
          startsAt: '10:00',
          endsAt: '11:00',
          nrc: '10001',
          assistantshipNrc: '20001',
          course: course('10001'),
          location: 'Lab 3',
          assistant: { id: 'ta-1', name: 'Pedro', email: 'pedro@ucn.cl' },
          state: 'ACTIVE',
          conflict: false,
        });
      });

      it('marca el estado de cada ayudantía según la fecha de hoy en Chile', async () => {
        // 11-10-2026 01:00 UTC todavía es 10-10-2026 en America/Santiago.
        jest.useFakeTimers().setSystemTime(new Date('2026-10-11T01:00:00Z'));
        try {
          prisma.teacher.findUnique.mockResolvedValue(teacher);
          prisma.academicSemester.findFirst.mockResolvedValue(semester);
          prisma.teachingAssignment.findMany.mockResolvedValue([]);
          const slot = (id: string) => [
            { id, weekday: 1, startsAtMinute: 490, endsAtMinute: 580 },
          ];
          prisma.assistantship.findMany.mockResolvedValue([
            assistantship('1', slot('por-empezar'), {
              startsOn: new Date('2026-10-11'),
              endsOn: null,
            }),
            assistantship('2', slot('termina-hoy'), {
              startsOn: new Date('2026-08-01'),
              endsOn: new Date('2026-10-10'),
            }),
            assistantship('3', slot('terminada'), {
              startsOn: new Date('2026-08-01'),
              endsOn: new Date('2026-10-09'),
            }),
          ]);

          const result = await service.getTeacherSchedule('teacher-1');

          expect(
            Object.fromEntries(
              result.entries.map(({ id, state }) => [id, state]),
            ),
          ).toEqual({
            'por-empezar': 'SCHEDULED',
            'termina-hoy': 'ACTIVE',
            terminada: 'COMPLETED',
          });
        } finally {
          jest.useRealTimers();
        }
      });

      it('incluye ayudantías aunque el docente no tenga horarios de clase', async () => {
        prisma.teacher.findUnique.mockResolvedValue(teacher);
        prisma.academicSemester.findFirst.mockResolvedValue(semester);
        prisma.teachingAssignment.findMany.mockResolvedValue([]);
        prisma.assistantship.findMany.mockResolvedValue([
          assistantship(null, [
            { id: 'a1', weekday: 3, startsAtMinute: 700, endsAtMinute: 790 },
          ]),
        ]);

        const result = await service.getTeacherSchedule('teacher-1');

        expect(prisma.courseSchedule.findMany).not.toHaveBeenCalled();
        expect(result.entries).toEqual([
          expect.objectContaining({
            id: 'a1',
            day: 'Miércoles',
            block: 'C',
            assistantshipNrc: null,
            nrc: '10001',
          }),
        ]);
      });
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
