import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicImportsService } from './academic-imports.service';

describe('AcademicImportsService', () => {
  const projectFindMany = jest.fn().mockResolvedValue([]);
  const projectCreate = jest.fn();
  const prisma = {
    project: { findMany: projectFindMany },
    $transaction: jest.fn(
      async (
        callback: (tx: {
          project: { create: typeof projectCreate };
        }) => Promise<unknown>,
      ) => callback({ project: { create: projectCreate } }),
    ),
  } as unknown as PrismaService;
  const service = new AcademicImportsService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    projectFindMany.mockResolvedValue([]);
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
    expect(projectCreate).toHaveBeenCalledTimes(1);
    const created = projectCreate.mock.calls[0][0].data;
    expect(created.currency).toBe('CLP');
    expect(created.participants.create).toHaveLength(2);
  });
});
