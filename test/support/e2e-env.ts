// Se ejecuta antes de cargar AppModule: fija un entorno aislado para que los
// tests E2E no dependan de .env.development ni se conecten a servicios reales.
// ConfigModule no sobrescribe variables ya definidas, por eso se fijan todas
// las que .env.development podría aportar.
Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'e2e-jwt-secret',
  ALLOWED_DOMAINS: 'ucn.cl,alumnos.ucn.cl',
  CACHE_TYPE: 'memory',
  GOOGLE_FORMS_WEBHOOK_SECRET: 'e2e-forms-secret',
  GOOGLE_CLIENT_ID: 'e2e-client-id',
  GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost/api/auth/google/callback',
  FRONTEND_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://e2e:e2e@127.0.0.1:1/e2e',
  DIRECT_URL: 'postgresql://e2e:e2e@127.0.0.1:1/e2e',
  STORAGE_PROVIDER: 'none',
  R2_ACCOUNT_ID: 'e2e-account',
  R2_ACCESS_KEY_ID: 'e2e-access-key',
  R2_SECRET_ACCESS_KEY: 'e2e-secret-key',
  R2_BUCKET_NAME: 'e2e-bucket',
  R2_ENDPOINT: 'https://e2e-account.r2.cloudflarestorage.com',
  R2_PRESIGNED_URL_EXPIRES_IN: '300',
  RESEND_API_KEY: '',
  NOTIFICATIONS_FROM: '',
  REDIS_URL: '',
});
