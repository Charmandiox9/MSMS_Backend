const legacySslMode = /([?&]sslmode=)(?:prefer|require|verify-ca)(?=[&#]|$)/gi;

/** Keep the current pg-connection-string TLS behavior explicit and stable. */
export function normalizePostgresSslMode(connectionString: string): string {
  return connectionString.replace(legacySslMode, '$1verify-full');
}
