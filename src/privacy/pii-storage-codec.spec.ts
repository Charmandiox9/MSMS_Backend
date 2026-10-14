import { PiiStorageCodec } from './pii-storage-codec';
import { testPiiCrypto } from './pii-test-config';

describe('Persistencia cifrada y contratos de consulta Prisma', () => {
  const crypto = testPiiCrypto();
  const codec = new PiiStorageCodec(crypto);
  it('cifra nombres, correo y RUT, conserva nulos y crea índices únicos normalizados', () => {
    const row = codec.write('Teacher', {
      id: 'id',
      name: 'Álvaro',
      email: ' PERSONA@UCN.CL ',
      rut: '12.345.678-5',
      employeeCode: null,
      professionalTitle: 'Bióloga Marina',
      institution: 'Universidad Católica del Norte',
    }) as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain('Álvaro');
    expect(JSON.stringify(row)).not.toContain('Bióloga Marina');
    expect(JSON.stringify(row)).not.toContain('Universidad Católica del Norte');
    expect(row.emailHash).toBe(
      crypto.blindIndex('persona@ucn.cl', 'Teacher.email'),
    );
    expect(row.rutHash).toBe(crypto.blindIndex('12345678-5', 'Teacher.rut'));
    expect(row.employeeCodeHash).toBeNull();
    expect(row.piiVersion).toBe(1);
    expect(codec.read('Teacher', row)).toEqual({
      id: 'id',
      name: 'Álvaro',
      email: ' PERSONA@UCN.CL ',
      rut: '12.345.678-5',
      employeeCode: null,
      professionalTitle: 'Bióloga Marina',
      institution: 'Universidad Católica del Norte',
    });
  });
  it('preserva transacciones: prepara createMany, upserts y escrituras anidadas sin texto en claro', () => {
    const data = codec.args('User', 'upsert', {
      where: { email: 'persona@ucn.cl' },
      create: { email: 'persona@ucn.cl', name: 'Nombre' },
      update: { name: { set: 'Otro' } },
    });
    expect(JSON.stringify(data)).not.toContain('persona@ucn.cl');
    expect(JSON.stringify(data)).not.toContain('Otro');
    const nested = codec.write('Justification', {
      studentEmail: 's@ucn.cl',
      history: { create: [{ note: 'Texto médico', changedById: 'actor' }] },
    });
    expect(JSON.stringify(nested)).not.toContain('Texto médico');
    expect(
      codec.read(
        'Justification',
        codec.write('Justification', { studentEmail: 's@ucn.cl' }),
      ),
    ).toEqual({ studentEmail: 's@ucn.cl' });
  });
  it('descifra relaciones y elimina índices internos de respuestas de API', () => {
    const teacher = codec.write('Teacher', {
      name: 'Nombre',
      email: 'p@ucn.cl',
    });
    const student = codec.write('Student', {
      name: 'Estudiante',
      email: 's@ucn.cl',
    });
    expect(
      codec.read('TeachingAssignment', {
        teacher,
        course: { name: 'Biología' },
      }),
    ).toEqual({
      teacher: { name: 'Nombre', email: 'p@ucn.cl' },
      course: { name: 'Biología' },
    });
    expect(codec.read('Justification', { student })).toEqual({
      student: { name: 'Estudiante', email: 's@ucn.cl' },
    });
  });
  it('transforma condiciones exactas, listas, negación y relaciones a HMAC', () => {
    const hash = crypto.blindIndex('p@ucn.cl', 'Teacher.email');
    expect(
      codec.where('Teacher', {
        OR: [
          { email: { equals: 'P@UCN.CL', mode: 'insensitive' } },
          { email: { in: ['p@ucn.cl'] } },
        ],
        rut: { not: null },
      }),
    ).toEqual({
      OR: [{ emailHash: { equals: hash } }, { emailHash: { in: [hash] } }],
      rutHash: { not: null },
    });
    expect(
      codec.where('TeachingAssignment', { teacher: { email: 'p@ucn.cl' } }),
    ).toEqual({ teacher: { emailHash: hash } });
  });
  it('conserva filtros de ID y versión con el DMMF de Prisma 7 y transforma selectores compuestos', () => {
    expect(
      codec.args('User', 'count', { where: { id: 'record', piiVersion: 0 } }),
    ).toEqual({ where: { id: 'record', piiVersion: 0 } });
    expect(
      codec.where('ProjectParticipant', {
        projectId_name_role: {
          projectId: 'project',
          name: 'Nombre',
          role: 'DIRECTOR',
        },
      }),
    ).toEqual({
      projectId_nameHash_role: {
        projectId: 'project',
        nameHash: crypto.blindIndex('Nombre', 'ProjectParticipant.name'),
        role: 'DIRECTOR',
      },
    });
  });
  it('rechaza filtros parciales y ordenación SQL de datos cifrados', () => {
    expect(() => codec.where('Teacher', { email: { contains: 'p' } })).toThrow(
      'parciales',
    );
    expect(() =>
      codec.args('Teacher', 'findMany', { orderBy: { name: 'asc' } }),
    ).toThrow('descifrarlos');
    expect(() =>
      codec.args('TeachingAssignment', 'findMany', {
        include: { teacher: { orderBy: { name: 'asc' } } },
      }),
    ).toThrow('descifrarlos');
  });
  it('protege nombres de participantes y metadatos de expedientes y autores', () => {
    for (const [model, row] of [
      [
        'ProjectParticipant',
        { name: 'Nombre', contactEmail: 'p@ucn.cl', gender: 'M' },
      ],
      ['ResearchParticipant', { name: 'Nombre' }],
      ['ResearchOutputAuthor', { name: 'Nombre', affiliation: 'Unidad' }],
      [
        'Project',
        { notes: 'Texto personal', folderUrl: 'https://example.test/nombre' },
      ],
    ]) {
      const prepared = codec.write(String(model), row);
      expect(codec.read(String(model), prepared)).toEqual(row);
      expect(JSON.stringify(prepared)).not.toContain('Nombre');
    }
  });
  it('transforma cursores sin modificar consultas reutilizadas y rechaza distinct cifrado', () => {
    const input = {
      cursor: { email: 'p@ucn.cl' },
      include: { assignments: { where: { teacher: { email: 'p@ucn.cl' } } } },
    };
    const original = JSON.stringify(input);
    const first = codec.args('Teacher', 'findMany', input);
    expect(JSON.stringify(input)).toBe(original);
    expect(first).toEqual(codec.args('Teacher', 'findMany', input));
    expect(first.cursor).toEqual({
      emailHash: crypto.blindIndex('p@ucn.cl', 'Teacher.email'),
    });
    expect(() =>
      codec.args('Teacher', 'findMany', { distinct: ['name'] }),
    ).toThrow('distinguir');
  });
});
