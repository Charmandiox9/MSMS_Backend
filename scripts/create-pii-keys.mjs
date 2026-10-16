import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// Never overwrite an existing key file or print the secrets.
const id = `key_${Date.now()}`;
await writeFile('.env.pii', [
  `PII_ACTIVE_KEY_ID=${id}`,
  `PII_ENCRYPTION_KEYS=${JSON.stringify({ [id]: randomBytes(32).toString('base64') })}`,
  `PII_BLIND_INDEX_KEY=${randomBytes(32).toString('base64')}`,
  '',
].join('\n'), { flag: 'wx', mode: 0o600 });
console.log('Claves independientes guardadas en .env.pii; conserva una copia segura y limita el acceso al archivo.');
