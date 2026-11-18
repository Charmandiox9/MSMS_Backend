import {
  LEGACY_ACCESS_COLUMNS,
  parseLegacyAccessRows,
  parseLegacyDefenseDate,
} from './legacy-access-import.util';

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    [LEGACY_ACCESS_COLUMNS.studentName]: 'Nombre Apellido',
    [LEGACY_ACCESS_COLUMNS.studentRut]: '11.111.111-1',
    [LEGACY_ACCESS_COLUMNS.studentEmail]: 'nombre@dominio.cl',
    [LEGACY_ACCESS_COLUMNS.studentPhone]: '+56 9 0000 0000',
    [LEGACY_ACCESS_COLUMNS.thesisTopic]: 'Tema de investigación',
    [LEGACY_ACCESS_COLUMNS.guideName]: 'Nombre Académico',
    [LEGACY_ACCESS_COLUMNS.coGuideName]: null,
    [LEGACY_ACCESS_COLUMNS.reviewerOneName]: 'Nombre Revisor',
    [LEGACY_ACCESS_COLUMNS.reviewerTwoName]: null,
    [LEGACY_ACCESS_COLUMNS.defenseDate]: '15 de octubre de 2025',
    ...overrides,
  };
}

describe('parseLegacyDefenseDate', () => {
  it('converts Spanish and numeric source dates to UTC dates', () => {
    expect(parseLegacyDefenseDate('15 de octubre de 2025')).toEqual(
      new Date('2025-10-15T00:00:00.000Z'),
    );
    expect(parseLegacyDefenseDate('15/10/2025')).toEqual(
      new Date('2025-10-15T00:00:00.000Z'),
    );
    expect(parseLegacyDefenseDate('2025-10-15')).toEqual(
      new Date('2025-10-15T00:00:00.000Z'),
    );
  });

  it('rejects impossible or unsupported dates', () => {
    expect(parseLegacyDefenseDate('31 de febrero de 2025')).toBeNull();
    expect(parseLegacyDefenseDate('fecha no disponible')).toBeNull();
  });
});

describe('parseLegacyAccessRows', () => {
  it('maps the available fields and records missing information without inventing values', () => {
    const result = parseLegacyAccessRows([
      sourceRow({
        [LEGACY_ACCESS_COLUMNS.studentEmail]: null,
        [LEGACY_ACCESS_COLUMNS.studentPhone]: null,
        [LEGACY_ACCESS_COLUMNS.defenseDate]: null,
      }),
    ]);

    expect(result.summary.canImport).toBe(true);
    expect(result.summary.missing).toMatchObject({
      studentEmail: 1,
      studentPhone: 1,
      defenseDate: 1,
      coGuideName: 1,
      reviewerTwoName: 1,
    });
    expect(result.summary.unavailable).toEqual({
      degree: 1,
      stage: 1,
      documentStatuses: 1,
    });
    expect(result.records[0]).toMatchObject({
      studentName: 'Nombre Apellido',
      studentRut: '11111111-1',
      studentEmail: null,
      studentPhone: null,
      thesisTopic: 'Tema de investigación',
      guideName: 'Nombre Académico',
      defenseDate: null,
    });
  });

  it('blocks invalid RUT, email, phone, and non-empty dates without printing row values', () => {
    const result = parseLegacyAccessRows([
      sourceRow({
        [LEGACY_ACCESS_COLUMNS.studentRut]: '11.111.111-0',
        [LEGACY_ACCESS_COLUMNS.studentEmail]: 'correo-invalido',
        [LEGACY_ACCESS_COLUMNS.studentPhone]: 'abc',
        [LEGACY_ACCESS_COLUMNS.defenseDate]: 'fecha no disponible',
      }),
    ]);

    expect(result.summary.canImport).toBe(false);
    expect(result.summary.invalid).toMatchObject({
      studentRut: 1,
      studentEmail: 1,
      studentPhone: 1,
      defenseDate: 1,
    });
  });

  it('blocks missing identifiers and duplicate RUTs needed for safe repeat imports', () => {
    const duplicate = sourceRow();
    const result = parseLegacyAccessRows([
      duplicate,
      { ...duplicate },
      sourceRow({ [LEGACY_ACCESS_COLUMNS.studentRut]: null }),
    ]);

    expect(result.summary.canImport).toBe(false);
    expect(result.summary.missing.studentRut).toBe(1);
    expect(result.summary.duplicateRuts).toBe(1);
  });
});
