export function normalizeChileanRut(value: string): string {
  const normalized = value.replace(/[.\s]/g, '').toUpperCase();
  const parts = normalized.match(/^(\d{7,8})-?([\dK])$/);
  if (!parts) return normalized;
  return `${parts[1]}-${parts[2]}`;
}

export function isValidChileanRut(value: string): boolean {
  const normalized = normalizeChileanRut(value);
  const parts = normalized.match(/^(\d{7,8})-([\dK])$/);
  if (!parts) return false;

  let factor = 2;
  let sum = 0;
  for (const digit of [...parts[1]].reverse()) {
    sum += Number(digit) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const remainder = 11 - (sum % 11);
  const expected =
    remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return parts[2] === expected;
}
