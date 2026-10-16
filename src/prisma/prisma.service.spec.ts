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
  it('bloquea el inicio si existen datos personales pendientes de conversión', async () => {
    jest.spyOn(service, '$connect').mockResolvedValue();
    jest.spyOn(service.user, 'count').mockResolvedValue(1);
    const teacherCount = jest.spyOn(service.teacher, 'count');
    await expect(service.onModuleInit()).rejects.toThrow('conversión PII de User');
    expect(teacherCount).not.toHaveBeenCalled();
  });
});
