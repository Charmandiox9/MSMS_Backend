import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { PiiCryptoService } from '../privacy/pii-crypto.service';
import { testPiiCrypto } from '../privacy/pii-test-config';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        { provide: PiiCryptoService, useValue: testPiiCrypto() },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('postgresql://localhost/test'),
          },
        },
      ],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(typeof service.onModuleInit).toBe('function');
    expect(typeof service.findPiiIds).toBe('function');
    expect(typeof service.$transaction).toBe('function');
  });
  it('busca sin tildes y trata porcentajes como texto después de descifrar', async () => {
    jest.spyOn(service.teacher, 'findMany').mockResolvedValue([
      {
        id: 'a',
        name: 'Álvaro',
        email: 'a@ucn.cl',
        employeeCode: null,
        rut: null,
      },
      {
        id: 'b',
        name: '50%_a',
        email: 'b@ucn.cl',
        employeeCode: null,
        rut: null,
      },
    ] as unknown as Awaited<ReturnType<typeof service.teacher.findMany>>);
    expect(await service.findPiiIds('Teacher', 'alvaro')).toEqual(['a']);
    expect(await service.findPiiIds('Teacher', '50%_')).toEqual(['b']);
  });
  it('permite limitar una búsqueda personal a un campo cifrado específico', async () => {
    const findMany = jest.spyOn(service.student, 'findMany').mockResolvedValue([
      { id: 'a', admission: '202610' },
      { id: 'b', admission: '202510' },
    ] as unknown as Awaited<ReturnType<typeof service.student.findMany>>);
    expect(await service.findPiiIds('Student', '2026', ['admission'])).toEqual([
      'a',
    ]);
    expect(findMany).toHaveBeenCalledWith({
      select: { id: true, admission: true },
    });
    await expect(
      service.findPiiIds('Student', '2026', ['createdAt']),
    ).rejects.toThrow('Los campos no permiten búsqueda PII');
  });
  it('busca RUT con o sin puntuación', async () => {
    jest
      .spyOn(service.student, 'findMany')
      .mockResolvedValue([
        { id: 'a', rut: '12.345.678-9' },
      ] as unknown as Awaited<ReturnType<typeof service.student.findMany>>);
    expect(await service.findPiiIds('Student', '12345678-9', ['rut'])).toEqual([
      'a',
    ]);
    expect(await service.findPiiIds('Student', '12345678', ['rut'])).toEqual([
      'a',
    ]);
    expect(
      await service.findPiiIds('Student', '12.345.678-9', ['rut']),
    ).toEqual(['a']);
  });
  it('restricts an exact RUT match to a complete normalized identifier', async () => {
    jest
      .spyOn(service.student, 'findMany')
      .mockResolvedValue([
        { id: 'a', rut: '12.345.678-9' },
      ] as unknown as Awaited<ReturnType<typeof service.student.findMany>>);
    await expect(
      service.findPiiIds('Student', '12345678-9', ['rut'], 'exact'),
    ).resolves.toEqual(['a']);
    await expect(
      service.findPiiIds('Student', '12345678', ['rut'], 'exact'),
    ).resolves.toEqual([]);
    await expect(
      service.findPiiIds('Student', '12345678-9', ['name', 'rut'], 'exclude'),
    ).resolves.toEqual([]);
  });
  it('busca por todas las personas del comité de titulación', async () => {
    const fields = [
      'guideName',
      'coGuideName',
      'reviewerOneName',
      'reviewerTwoName',
    ] as const;
    const findMany = jest
      .spyOn(service.titulationProcess, 'findMany')
      .mockResolvedValue([
        {
          id: 'process-1',
          guideName: 'committee-member-1',
          coGuideName: 'committee-member-2',
          reviewerOneName: 'committee-member-3',
          reviewerTwoName: 'committee-member-4',
        },
      ] as unknown as Awaited<
        ReturnType<typeof service.titulationProcess.findMany>
      >);

    for (const field of fields) {
      await expect(
        service.findPiiIds('TitulationProcess', 'committee-member', [field]),
      ).resolves.toEqual(['process-1']);
    }

    expect(findMany).toHaveBeenNthCalledWith(1, {
      select: { id: true, guideName: true },
    });
    expect(findMany).toHaveBeenNthCalledWith(2, {
      select: { id: true, coGuideName: true },
    });
    expect(findMany).toHaveBeenNthCalledWith(3, {
      select: { id: true, reviewerOneName: true },
    });
    expect(findMany).toHaveBeenNthCalledWith(4, {
      select: { id: true, reviewerTwoName: true },
    });
  });
  it('bloquea el inicio si existen datos personales pendientes de conversión', async () => {
    jest.spyOn(service, '$connect').mockResolvedValue();
    jest.spyOn(service.user, 'count').mockResolvedValue(1);
    const teacherCount = jest.spyOn(service.teacher, 'count');
    await expect(service.onModuleInit()).rejects.toThrow(
      'conversión PII de User',
    );
    expect(teacherCount).not.toHaveBeenCalled();
  });
});
