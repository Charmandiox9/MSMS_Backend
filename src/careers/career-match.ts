interface CareerIdentity {
  id: string;
  code: string | null;
  name: string;
}

function normalizeCareerName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^ing\b/, 'ingenieria');
}

export function resolveCareer(
  careers: readonly CareerIdentity[],
  code?: string | null,
  name?: string | null,
) {
  const normalizedCode = code?.trim().toLowerCase();
  if (normalizedCode) {
    const matches = careers.filter(
      (career) => career.code?.trim().toLowerCase() === normalizedCode,
    );
    if (matches.length) return matches.length === 1 ? matches[0] : undefined;
  }

  const normalizedName = name && normalizeCareerName(name);
  if (!normalizedName) return undefined;
  const matches = careers.filter(
    (career) => normalizeCareerName(career.name) === normalizedName,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
