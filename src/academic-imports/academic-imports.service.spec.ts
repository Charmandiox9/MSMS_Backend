import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicImportsService } from './academic-imports.service';

describe('AcademicImportsService', () => {
  const projectFindMany = jest.fn().mockResolvedValue([]);
  const projectCreate = jest.fn();
  const outputFindMany = jest.fn().mockResolvedValue([]);
  const outputCreate = jest.fn();
  const semester = {
    id: 'semester-1',
    name: '2026-20',
    startsOn: new Date('2026-08-01T00:00:00Z'),
    endsOn: new Date('2026-12-31T00:00:00Z'),
  };
  const hourlyRate = {
    id: 'rate-1',
    semesterId: semester.id,
    category: 'NEW',
    academicDegree: 'PROFESSIONAL',
    certification: 'NONE',
    hourlyRateClp: '52000',
  };
  const academicSemesterFindFirst = jest.fn().mockResolvedValue(semester);
  const teacherFindMany = jest.fn().mockResolvedValue([
    {
      id: 'teacher-1',
      rut: '18731016-4',
      academicDegree: 'PROFESSIONAL',
      certification: 'NONE',
    },
  ]);
  const teacherFindUnique = jest.fn().mockResolvedValue({
    academicDegree: 'PROFESSIONAL',
    certification: 'NONE',
  });
  const teacherUpdate = jest.fn();
  const teacherUpsert = jest.fn().mockResolvedValue({ id: 'teacher-new' });
  const rateFindMany = jest.fn().mockResolvedValue([hourlyRate]);
  const rateFindUnique = jest.fn().mockResolvedValue(hourlyRate);
  const schedulesFindMany = jest
    .fn()
    .mockResolvedValue([{ nrc: 'DCCB 00202', courseId: 'course-1' }]);
  const schedulesFindFirst = jest
    .fn()
    .mockResolvedValue({ courseId: 'course-1' });
  const assignmentsFindMany = jest.fn().mockResolvedValue([]);
  const assignmentsFindFirst = jest.fn();
  const assignmentsUpsert = jest.fn().mockResolvedValue({ id: 'assignment-1' });
  const enrollmentsFindMany = jest.fn().mockResolvedValue([]);
  const contractFindFirst = jest.fn().mockResolvedValue(null);
  const contractCreate = jest.fn();
  const tx = {
    project: { create: projectCreate },
    researchOutput: { create: outputCreate },
    academicSemester: { findFirst: academicSemesterFindFirst },
    teacher: {
      findMany: teacherFindMany,
      findUnique: teacherFindUnique,
      update: teacherUpdate,
      upsert: teacherUpsert,
    },
    hourlyPayRate: { findMany: rateFindMany, findUnique: rateFindUnique },
    courseSchedule: {
      findMany: schedulesFindMany,
      findFirst: schedulesFindFirst,
    },
    teachingAssignment: {
      findMany: assignmentsFindMany,
      findFirst: assignmentsFindFirst,
      upsert: assignmentsUpsert,
    },
    studentEnrollment: { findMany: enrollmentsFindMany },
    hourlyTeachingContract: {
      findFirst: contractFindFirst,
      create: contractCreate,
    },
  };
  const prisma = {
    project: { findMany: projectFindMany },
    researchOutput: { findMany: outputFindMany },
    academicSemester: { findFirst: academicSemesterFindFirst },
    teacher: {
      findMany: teacherFindMany,
      findUnique: teacherFindUnique,
      update: teacherUpdate,
      upsert: teacherUpsert,
    },
    hourlyPayRate: { findMany: rateFindMany, findUnique: rateFindUnique },
    courseSchedule: {
      findMany: schedulesFindMany,
      findFirst: schedulesFindFirst,
    },
    teachingAssignment: {
      findMany: assignmentsFindMany,
      findFirst: assignmentsFindFirst,
      upsert: assignmentsUpsert,
    },
    studentEnrollment: { findMany: enrollmentsFindMany },
    hourlyTeachingContract: {
      findFirst: contractFindFirst,
      create: contractCreate,
    },
    $transaction: jest.fn(
      async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  } as unknown as PrismaService;
  const service = new AcademicImportsService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    projectFindMany.mockResolvedValue([]);
    outputFindMany.mockResolvedValue([]);
    academicSemesterFindFirst.mockResolvedValue(semester);
    teacherFindMany.mockResolvedValue([
      {
        id: 'teacher-1',
        rut: '18731016-4',
        academicDegree: 'PROFESSIONAL',
        certification: 'NONE',
      },
    ]);
    rateFindMany.mockResolvedValue([hourlyRate]);
    schedulesFindMany.mockResolvedValue([
      { nrc: 'DCCB 00202', courseId: 'course-1' },
    ]);
    assignmentsFindMany.mockResolvedValue([]);
    enrollmentsFindMany.mockResolvedValue([]);
    schedulesFindFirst.mockResolvedValue({ courseId: 'course-1' });
    teacherFindUnique.mockResolvedValue({
      academicDegree: 'PROFESSIONAL',
      certification: 'NONE',
    });
    contractFindFirst.mockResolvedValue(null);
  });

  async function workbookBase64(
    title: string,
    start = new Date('2025-01-01T00:00:00Z'),
    end = new Date('2025-12-31T00:00:00Z'),
  ) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('proyectos');
    sheet.getRow(2).getCell(1).value = 'AÑO';
    const row = sheet.getRow(3);
    row.getCell(1).value = 2025;
    row.getCell(2).value = 'FCM';
    row.getCell(3).value = 'RES-25';
    row.getCell(4).value = start;
    row.getCell(5).value = end;
    row.getCell(6).value = title;
    row.getCell(7).value = 'PR-25';
    row.getCell(8).value = 'Profesora';
    row.getCell(12).value = 100000;
    row.getCell(22).value = 'Profesora; Integrante';
    return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  }

  async function eprymaBase64() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Publicaciones');
    sheet.getRow(5).getCell(3).value = 'Titulo';
    const row = sheet.getRow(6);
    row.getCell(2).value = 'Investigador, Nombre';
    row.getCell(3).value = 'Artículo de prueba';
    row.getCell(4).value = '10.1234/demo';
    row.getCell(5).value = 'Revista';
    row.getCell(6).value = '1234-5678';
    row.getCell(7).value = 'Q2';
    row.getCell(8).value = 3.2;
    row.getCell(9).value = new Date('2026-03-04T00:00:00Z');
    row.getCell(10).value = 'WoS';
    row.getCell(11).value = 'ANID 1234';
    row.getCell(12).value = true;
    row.getCell(13).value = 'Estudiante, Nombre';
    row.getCell(14).value = false;
    const books = workbook.addWorksheet('Libros');
    books.getRow(3).getCell(4).value = 'Título del capítulo y/o libro';
    const book = books.getRow(4);
    book.getCell(2).value = 'Autor de libro';
    book.getCell(3).value = 2024;
    book.getCell(4).value = 'Libro de prueba';
    book.getCell(5).value = 'Antofagasta';
    book.getCell(6).value = 'Editorial';
    book.getCell(7).value = '978-1-23456-789-0';
    const intellectualProperty = workbook.addWorksheet('Propiedad intelectual');
    intellectualProperty.getRow(1).getCell(2).value = 'Tema';
    const property = intellectualProperty.getRow(2);
    property.getCell(1).value = 'Inventora';
    property.getCell(2).value = 'Patente de prueba';
    property.getCell(3).value = 'PR-25';
    property.getCell(4).value = 'Patente';
    property.getCell(5).value = 'Solicitada';
    property.getCell(6).value = new Date('2025-06-01T00:00:00Z');
    return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  }

  async function hourlyBase64() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('pagos ');
    sheet.getRow(4).getCell(6).value = 'Rut';
    const row = sheet.getRow(5);
    row.getCell(1).value = 'DCCB 00202';
    row.getCell(3).value = 'Lab.';
    row.getCell(4).value = 'L3';
    row.getCell(5).value = 'Docente';
    row.getCell(6).value = '18.731.016-4';
    row.getCell(7).value = 'Nuevo';
    row.getCell(8).value = 'Profesional';
    row.getCell(9).value = 'Sin Cert.';
    row.getCell(10).value = 3;
    row.getCell(11).value = 156000;
    row.getCell(12).value = new Date('2026-08-17T00:00:00Z');
    row.getCell(13).value = new Date('2026-12-19T00:00:00Z');
    return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  }

  it('previews project rows and keeps names out of the preview sample', async () => {
    const preview = await service.previewProjects(
      await workbookBase64('Proyecto A'),
    );
    expect(preview).toMatchObject({
      totalRows: 1,
      importable: 1,
      errors: [],
      duplicates: [],
    });
    expect(preview.sample[0]).toMatchObject({
      title: 'Proyecto A',
      code: 'PR-25',
      reportingYear: 2025,
    });
    expect(JSON.stringify(preview)).not.toContain('Profesora');
  });

  it('reports invalid date order instead of guessing a correction', async () => {
    const preview = await service.previewProjects(
      await workbookBase64(
        'Proyecto A',
        new Date('2026-01-01T00:00:00Z'),
        new Date('2025-01-01T00:00:00Z'),
      ),
    );
    expect(preview.importable).toBe(0);
    expect(preview.errors[0]).toMatchObject({
      row: 3,
      message: expect.stringContaining('precede'),
    });
  });

  it('skips a project code that already exists', async () => {
    projectFindMany.mockResolvedValue([
      {
        code: 'PR-25',
        title: 'Proyecto A',
        reportingYear: 2025,
        academicUnit: 'FCM',
      },
    ]);
    const preview = await service.previewProjects(
      await workbookBase64('Proyecto A'),
    );
    expect(preview.importable).toBe(0);
    expect(preview.duplicates).toEqual([
      { row: 3, message: 'el código ya existe en el repositorio' },
    ]);
  });

  it('rejects a workbook that does not match the projects template', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('otro');
    const base64 = Buffer.from(await workbook.xlsx.writeBuffer()).toString(
      'base64',
    );
    await expect(service.previewProjects(base64)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('commits valid rows together and reports skipped records', async () => {
    await service.importProjects(await workbookBase64('Proyecto A'));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: 'Serializable',
        timeout: 60_000,
      }),
    );
    expect(projectCreate).toHaveBeenCalledTimes(1);
    const created = projectCreate.mock.calls[0][0].data;
    expect(created.currency).toBe('CLP');
    expect(created.participants.create).toHaveLength(2);
  });

  it('previews EPRYMA publications without exposing author PII', async () => {
    const preview = await service.previewResearch(await eprymaBase64());
    expect(preview).toMatchObject({
      totalRows: 3,
      importable: 3,
      errors: [],
      duplicates: [],
    });
    expect(preview.sample.map(({ title }) => title)).toEqual([
      'Artículo de prueba',
      'Libro de prueba',
      'Patente de prueba',
    ]);
    expect(JSON.stringify(preview)).not.toContain('Investigador, Nombre');
  });

  it('imports EPRYMA authors into the encrypted academic-output model', async () => {
    await service.importResearch(await eprymaBase64());
    expect(outputCreate).toHaveBeenCalledTimes(3);
    const created = outputCreate.mock.calls[0][0].data;
    expect(created.doi).toBe('10.1234/demo');
    expect(created.authors.create).toEqual([
      { name: 'Investigador, Nombre', position: 1, isStudent: null },
      { name: 'Estudiante, Nombre', position: 2, isStudent: true },
    ]);
    expect(outputCreate.mock.calls.map(([call]) => call.data.kind)).toEqual([
      'ARTICLE',
      'BOOK',
      'INTELLECTUAL_PROPERTY',
    ]);
  });

  it('previews hourly contracts using the active semester rate and hides RUTs', async () => {
    const preview = await service.previewHourly(await hourlyBase64());
    expect(preview).toMatchObject({
      totalRows: 1,
      importable: 1,
      errors: [],
      duplicates: [],
    });
    expect(Number(preview.estimatedTotalClp)).toBeGreaterThan(156000);
    expect(JSON.stringify(preview)).not.toContain('18731016-4');
  });

  it('imports hourly contracts and updates only missing teacher degree data', async () => {
    await service.importHourly(await hourlyBase64());
    expect(assignmentsUpsert).toHaveBeenCalledTimes(1);
    expect(contractCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payRateId: 'rate-1', directHours: 3 }),
      }),
    );
  });

  it('requests an email before creating a new teacher from the PH workbook', async () => {
    teacherFindMany.mockResolvedValue([]);
    const file = await hourlyBase64();
    const incomplete = await service.previewHourly(file);
    expect(incomplete.importable).toBe(0);
    expect(incomplete.unmatchedTeachers).toEqual([
      { rut: '18731016-4', name: 'Docente', rows: [5] },
    ]);
    const confirmed = await service.previewHourly(file, [
      { rut: '18731016-4', email: 'new.teacher@ucn.cl' },
    ]);
    expect(confirmed.importable).toBe(1);
    expect(confirmed.unmatchedTeachers).toEqual([]);
    await service.importHourly(file, [
      { rut: '18731016-4', email: 'new.teacher@ucn.cl' },
    ]);
    expect(teacherUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { rut: '18731016-4' },
        create: expect.objectContaining({
          name: 'Docente',
          email: 'new.teacher@ucn.cl',
          rut: '18731016-4',
        }),
      }),
    );
  });
});
