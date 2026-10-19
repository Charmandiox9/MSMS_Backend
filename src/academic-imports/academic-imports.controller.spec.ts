import { AcademicImportType } from '@prisma/client';
import { AcademicImportsController } from './academic-imports.controller';
import { AcademicImportQueueService } from './academic-import-queue.service';
import { AcademicImportsService } from './academic-imports.service';

describe('AcademicImportsController', () => {
  const enqueue = jest.fn();
  const getStatus = jest.fn();
  const queue = { enqueue, getStatus } as unknown as AcademicImportQueueService;
  const imports = {
    previewProjects: jest.fn(),
    previewResearch: jest.fn(),
    previewHourly: jest.fn(),
  } as unknown as AcademicImportsService;
  const controller = new AcademicImportsController(imports, queue);

  beforeEach(() => jest.clearAllMocks());

  it('enqueues the validated project import and records its actor', async () => {
    const input = { fileBase64: 'cHJvamVjdA==' };
    const user = { id: 'user-1', roles: ['ACADEMIC_SECRETARY'] };
    await controller.importProjects(input, user);
    expect(enqueue).toHaveBeenCalledWith(
      AcademicImportType.PROJECTS,
      input,
      'user-1',
    );
  });

  it('exposes status lookup by job id', async () => {
    await controller.getJobStatus('job-id');
    expect(getStatus).toHaveBeenCalledWith('job-id');
  });

  it('queues a new career and its first imported curriculum with the requesting actor', async () => {
    const input = {
      code: 'BIO-MAR',
      name: 'Biología Marina',
      cohortYear: 2026,
      courses: [{ courseName: 'Biología', termNumber: 1 }],
    };
    const user = { id: 'secretary-1', roles: ['ACADEMIC_SECRETARY'] };

    await controller.importCareerCurriculum(input, user);

    expect(enqueue).toHaveBeenCalledWith(
      AcademicImportType.CURRICULUM,
      { operation: 'CREATE_CAREER', input },
      'secretary-1',
    );
  });

  it('queues a new cohort curriculum for an existing career', async () => {
    const careerId = '11111111-1111-4111-8111-111111111111';
    const input = {
      cohortYear: 2026,
      courses: [{ courseName: 'Biología', termNumber: 1 }],
    };
    const user = { id: 'secretary-1', roles: ['ACADEMIC_SECRETARY'] };

    await controller.importCurriculum(careerId, input, user);

    expect(enqueue).toHaveBeenCalledWith(
      AcademicImportType.CURRICULUM,
      { operation: 'ADD_VERSION', careerId, input },
      'secretary-1',
    );
  });
});
