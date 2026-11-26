import { randomUUID } from 'crypto';
import type autocannon from 'autocannon';

export interface StressConfig {
  baseUrl: string;
  authCookie?: string;
  formsSecret?: string;
  formsUploadSecret?: string;
  nrc: string;
}

export interface Scenario {
  name: string;
  description: string;
  /** Códigos HTTP que cuentan como respuesta correcta. */
  expectedStatus: number[];
  /** Motivo por el que el escenario no se puede ejecutar con la configuración actual. */
  skipReason?: string;
  requests: autocannon.Request[];
}

const json = { 'content-type': 'application/json' };

export function buildScenarios(config: StressConfig): Scenario[] {
  const auth = config.authCookie ? { cookie: config.authCookie } : undefined;
  const needsAuth = auth ? undefined : 'define STRESS_AUTH_COOKIE';
  const forms = config.formsSecret
    ? { 'x-marsys-forms-secret': config.formsSecret }
    : undefined;
  const needsForms = forms ? undefined : 'define STRESS_FORMS_SECRET';
  const formsUpload = config.formsUploadSecret
    ? { 'x-marsys-forms-secret': config.formsUploadSecret }
    : undefined;

  return [
    {
      name: 'health',
      description: 'GET / público, línea base del servidor',
      expectedStatus: [200],
      requests: [{ method: 'GET', path: '/' }],
    },
    {
      name: 'auth-rejection',
      description:
        'GET /justifications sin sesión: costo de rechazar tráfico no autenticado',
      expectedStatus: [401],
      requests: [{ method: 'GET', path: '/justifications' }],
    },
    {
      name: 'session',
      description:
        'GET /auth/session con la cookie (validación de JWT o sesión)',
      expectedStatus: [200],
      skipReason: needsAuth,
      requests: [{ method: 'GET', path: '/auth/session', headers: auth }],
    },
    {
      name: 'justifications-list',
      description: 'GET /justifications con profesores y bloques por cada fila',
      expectedStatus: [200],
      skipReason: needsAuth,
      requests: [{ method: 'GET', path: '/justifications', headers: auth }],
    },
    {
      name: 'justifications-pending',
      description: 'GET /justifications?status=PENDING',
      expectedStatus: [200],
      skipReason: needsAuth,
      requests: [
        {
          method: 'GET',
          path: '/justifications?status=PENDING',
          headers: auth,
        },
      ],
    },
    {
      name: 'inbox-list',
      description: 'GET /justifications/inbox (rol coordinador)',
      expectedStatus: [200],
      skipReason: needsAuth,
      requests: [
        { method: 'GET', path: '/justifications/inbox', headers: auth },
      ],
    },
    {
      name: 'presigned-upload',
      description: 'POST /storage/presigned-upload: firma de URLs de subida',
      expectedStatus: [201],
      skipReason: needsAuth,
      requests: [
        {
          method: 'POST',
          path: '/storage/presigned-upload',
          headers: { ...json, ...auth },
          body: JSON.stringify({
            fileName: 'evidencia.pdf',
            contentType: 'application/pdf',
          }),
        },
      ],
    },
    {
      name: 'forms-presigned-upload',
      description:
        'POST /storage/presigned-upload/forms con el secreto del webhook',
      expectedStatus: [201],
      skipReason: formsUpload ? undefined : 'define STRESS_FORMS_UPLOAD_SECRET',
      requests: [
        {
          method: 'POST',
          path: '/storage/presigned-upload/forms',
          headers: { ...json, ...formsUpload },
          body: JSON.stringify({
            fileName: 'justificativo.jpg',
            contentType: 'image/jpeg',
            externalResponseId: 'stress-upload',
          }),
        },
      ],
    },
    {
      name: 'forms-webhook-rejection',
      description:
        'POST /justifications/inbox con secreto incorrecto (no escribe datos)',
      expectedStatus: [401],
      requests: [
        {
          method: 'POST',
          path: '/justifications/inbox',
          headers: {
            ...json,
            'x-marsys-forms-secret': 'stress-invalid-secret',
          },
          body: JSON.stringify(inboxPayload('rejected', config.nrc)),
        },
      ],
    },
    {
      name: 'forms-inbox-unissued-evidence',
      description: 'POST /justifications/inbox sin evidencia autorizada',
      expectedStatus: [400],
      skipReason: needsForms,
      requests: [
        {
          method: 'POST',
          path: '/justifications/inbox',
          headers: { ...json, ...forms },
          setupRequest: (request) => ({
            ...request,
            body: JSON.stringify(
              inboxPayload(`stress-${randomUUID()}`, config.nrc),
            ),
          }),
        },
      ],
    },
  ];
}

function inboxPayload(externalResponseId: string, nrc: string) {
  return {
    externalResponseId,
    studentEmail: 'stress-test@alumnos.ucn.cl',
    absenceDate: new Date().toISOString().slice(0, 10),
    subjectName: 'Prueba de estrés',
    nrc,
    reason: 'Registro generado por la prueba de estrés',
    evidenceKey: 'uploads/stress-test.pdf',
    evidenceContentType: 'application/pdf',
  };
}
