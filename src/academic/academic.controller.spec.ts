import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AcademicController,
  AcademicCoursesController,
  AcademicSemestersController,
} from './academic.controller';
import { AcademicService } from './academic.service';

describe('Controladores académicos', () => {
  const service = {
    listTeachers: jest.fn().mockResolvedValue(['teacher']),
    getTeacher: jest.fn().mockResolvedValue({ id: 'teacher-1' }),
    importCsv: jest.fn().mockResolvedValue({ importedRows: 1 }),
    importTeacherRoster: jest.fn().mockResolvedValue({ importedTeachers: 1 }),
    listCourseSchedules: jest.fn().mockResolvedValue(['schedule']),
    importCourseSchedules: jest.fn().mockResolvedValue({ importedRows: 2 }),
    listSemesters: jest.fn().mockResolvedValue(['semester']),
    activateSemester: jest.fn().mockResolvedValue({ id: 'sem-1' }),
  };
  const academicService = service as unknown as AcademicService;

  it('AcademicController delega consultas e importaciones al servicio', async () => {
    const controller = new AcademicController(academicService);

    await expect(controller.listTeachers()).resolves.toEqual(['teacher']);
    await expect(controller.getTeacher('teacher-1')).resolves.toEqual({
      id: 'teacher-1',
    });
    await controller.importCsv({ csv: 'a,b' });
    await controller.importRoster({ csv: 'c,d' });

    expect(service.getTeacher).toHaveBeenCalledWith('teacher-1');
    expect(service.importCsv).toHaveBeenCalledWith('a,b');
    expect(service.importTeacherRoster).toHaveBeenCalledWith('c,d');
  });

  it('AcademicCoursesController delega horarios al servicio', async () => {
    const controller = new AcademicCoursesController(academicService);

    await expect(controller.listCourseSchedules()).resolves.toEqual([
      'schedule',
    ]);
    await controller.importCourseSchedules({
      csv: 'nrc,asignatura,dia,bloque',
    });

    expect(service.importCourseSchedules).toHaveBeenCalledWith(
      'nrc,asignatura,dia,bloque',
    );
  });

  it('AcademicSemestersController delega la activación de semestres', async () => {
    const controller = new AcademicSemestersController(academicService);

    await expect(controller.listSemesters()).resolves.toEqual(['semester']);
    await controller.activateSemester({
      name: '2026-2',
      startsOn: '2026-08-01',
      endsOn: '2026-12-15',
    });

    expect(service.activateSemester).toHaveBeenCalledWith(
      '2026-2',
      '2026-08-01',
      '2026-12-15',
    );
  });

  it('valida los DTO de importación y semestre', async () => {
    const { CsvImportDto, SemesterDto } = dtoClasses();

    await expect(
      validate(plainToInstance(CsvImportDto, { csv: '' })),
    ).resolves.toHaveLength(1);
    await expect(
      validate(plainToInstance(CsvImportDto, { csv: 'a,b' })),
    ).resolves.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(SemesterDto, {
          name: '2026-2',
          startsOn: 'ayer',
          endsOn: '2026-12-15',
        }),
      ),
    ).resolves.toHaveLength(1);
    await expect(
      validate(
        plainToInstance(SemesterDto, {
          name: '2026-2',
          startsOn: '2026-08-01',
          endsOn: '2026-12-15',
        }),
      ),
    ).resolves.toHaveLength(0);
  });
});

// Los DTO no se exportan; se obtienen desde los metadatos de parámetros de cada handler.
function dtoClasses() {
  const paramTypes = (controller: object, method: string) =>
    Reflect.getMetadata(
      'design:paramtypes',
      controller,
      method,
    ) as (new () => object)[];
  return {
    CsvImportDto: paramTypes(AcademicController.prototype, 'importCsv')[0],
    SemesterDto: paramTypes(
      AcademicSemestersController.prototype,
      'activateSemester',
    )[0],
  };
}
