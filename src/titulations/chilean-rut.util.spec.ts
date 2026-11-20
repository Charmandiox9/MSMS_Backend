import { isValidChileanRut, normalizeChileanRut } from './chilean-rut.util';

describe('Chilean RUT utilities', () => {
  it('normalizes punctuation and casing', () => {
    expect(normalizeChileanRut('12.345.678-k')).toBe('12345678-K');
  });

  it('validates check digits', () => {
    expect(isValidChileanRut('12.345.678-5')).toBe(true);
    expect(isValidChileanRut('12.345.678-0')).toBe(false);
  });

  it('rejects malformed identifiers', () => {
    expect(isValidChileanRut('123')).toBe(false);
  });
});
