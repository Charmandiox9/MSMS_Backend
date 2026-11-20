export type LegacyAccessImportTarget = 'local' | 'development';

export function parseEnvironmentValue(
  contents: string,
  variableName: string,
): string | null {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assignment = contents.match(
    new RegExp(`^\\s*(?:export\\s+)?${escapedName}\\s*=\\s*(.*)\\s*$`, 'm'),
  );
  if (!assignment) return null;

  const rawValue = assignment[1].trim();
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  )
    return rawValue.slice(1, -1);

  return rawValue.replace(/\s+#.*$/, '').trim() || null;
}

export function isLocalDatabase(connectionString: string): boolean {
  try {
    const hostname = new URL(connectionString).hostname
      .toLocaleLowerCase('en')
      .replace(/^\[|\]$/g, '');
    return ['localhost', '127.0.0.1', '::1', 'db'].includes(hostname);
  } catch {
    return false;
  }
}

export function isSameDatabaseEndpoint(
  connectionString: string,
  configuredDevelopmentString: string,
): boolean {
  try {
    const actual = new URL(connectionString);
    const configured = new URL(configuredDevelopmentString);
    const normalizeHostname = (hostname: string) =>
      hostname.toLocaleLowerCase('en').replace(/-pooler(?=\.|$)/, '');

    return (
      actual.protocol === configured.protocol &&
      normalizeHostname(actual.hostname) ===
        normalizeHostname(configured.hostname) &&
      actual.port === configured.port &&
      actual.pathname.replace(/\/+$/, '') ===
        configured.pathname.replace(/\/+$/, '') &&
      actual.username === configured.username
    );
  } catch {
    return false;
  }
}
