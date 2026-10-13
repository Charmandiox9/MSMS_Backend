import { BadRequestException } from '@nestjs/common';
import { parseStudentCsv } from './student-csv';

describe('CSV de estudiantes', () => {
  it('normaliza correos y permite varios NRC, cabecera UTF-8 y filas vacías', () => {
    expect(
      parseStudentCsv(
        '\uFEFFnombre;correo;nrc1;nrc2\n\nAna Soto; ANA@example.com ;10001|10002;10001',
      ),
    ).toEqual([
      {
        line: 3,
        name: 'Ana Soto',
        email: 'ana@example.com',
        nrcs: ['10001', '10002'],
      },
    ]);
  });
  it('admite coma, nombres entre comillas, comas y comillas escapadas', () => {
    expect(
      parseStudentCsv(
        'name,email,nrc\n"Soto, Ana ""María""",ana@example.com,10001',
      )[0].name,
    ).toBe('Soto, Ana "María"');
  });
  it.each([
    ['nombre;correo;nrc', 'no contiene estudiantes'],
    ['nombre;correo\nAna;ana@example.com', 'columnas nombre'],
    ['nombre;correo;nrc\nAna;bad;10001', 'Fila 2: correo inválido'],
    ['nombre;correo;nrc\nAna;ana@example.com;', 'Fila 2: indica NRC'],
    [
      'nombre;correo;nrc\nAna;ana@example.com;10001\nOtra;ANA@example.com;10002',
      'Fila 3: correo repetido',
    ],
    [
      'nombre;correo;nrc;nrc\nAna;ana@example.com;10001;10002',
      'cabeceras repetidas',
    ],
    [
      'nombre;correo;nrc\nAna;ana@example.com;10001;extra',
      'cantidad de columnas',
    ],
    ['nombre;correo;nrc\n"Ana;ana@example.com;10001', 'comillas sin cerrar'],
  ])(
    'rechaza datos inválidos sin perder el número de fila (%s)',
    (csv, message) => {
      expect(() => parseStudentCsv(csv)).toThrow(message);
    },
  );
  it('rechaza archivos demasiado grandes', () => {
    expect(() => parseStudentCsv('x'.repeat(2_000_001))).toThrow(
      BadRequestException,
    );
  });
  it('procesa 5000 estudiantes y rechaza exceder el límite de filas', () => {
    const csv =
      'nombre;correo;nrc\n' +
      Array.from(
        { length: 5000 },
        (_, index) => `Estudiante ${index};student${index}@example.com;10001`,
      ).join('\n');
    expect(parseStudentCsv(csv)).toHaveLength(5000);
    expect(() =>
      parseStudentCsv(csv + '\nOtro;otro@example.com;10001'),
    ).toThrow('hasta 5000 estudiantes');
  });
});
