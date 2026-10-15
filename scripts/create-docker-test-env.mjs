import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const secret = () => randomBytes(32).toString('hex');
const databasePassword = secret();
const redisPassword = secret();
const env = {
  DB_USER: 'marsys', DB_NAME: 'marsys_docker_test', DB_PASSWORD: databasePassword,
  DATABASE_URL: `postgresql://marsys:${databasePassword}@db:5432/marsys_docker_test?schema=public`,
  DIRECT_URL: `postgresql://marsys:${databasePassword}@db:5432/marsys_docker_test?schema=public`,
  REDIS_PASSWORD: redisPassword, REDIS_URL: `redis://default:${redisPassword}@redis:6379`,
  PII_ACTIVE_KEY_ID: 'docker_test',
  PII_ENCRYPTION_KEYS: JSON.stringify({ docker_test: randomBytes(32).toString('base64') }),
  PII_BLIND_INDEX_KEY: randomBytes(32).toString('base64'), JWT_SECRET: secret(),
  GOOGLE_CLIENT_ID: 'docker-test-not-a-real-client', GOOGLE_CLIENT_SECRET: secret(),
  GOOGLE_CALLBACK_URL: 'http://localhost:18080/api/auth/google/callback',
  FRONTEND_URL: 'http://localhost:18080', ALLOWED_DOMAINS: 'example.test',
  GOOGLE_FORMS_WEBHOOK_SECRET: secret(), BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test',
  STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_REGION: 'us-east-1',
  S3_BUCKET_NAME: 'marsys-test-evidence', S3_ACCESS_KEY: `app${secret().slice(0, 16)}`, S3_SECRET_KEY: secret(),
  MINIO_ROOT_USER: `root${secret().slice(0, 16)}`, MINIO_ROOT_PASSWORD: secret(),
  // Installed legacy images are selected explicitly for local compatibility testing only.
  MINIO_IMAGE: 'minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e',
  MC_IMAGE: 'minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727', NGINX_HTTP_PORT: '18080', S3_TEST_PORT: '19000',
};
writeFileSync('.env.docker-test', Object.entries(env).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log('Creado .env.docker-test con secretos locales nuevos; no se imprimen valores.');
