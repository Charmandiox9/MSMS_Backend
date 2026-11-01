import { createHash } from 'node:crypto';

export const CURRENT_TERMS_VERSION = '2026.11.0-draft.1';

const terms = {
  es: {
    locale: 'es',
    title: 'Términos de uso de MARSYS',
    notice:
      'Borrador técnico preliminar. Requiere revisión y aprobación institucional antes de su uso en producción.',
    sections: [
      {
        heading: '1. Alcance del servicio',
        paragraphs: [
          'MARSYS es una plataforma de apoyo a la gestión académica de la Facultad de Ciencias del Mar de la Universidad Católica del Norte. Sus funciones disponibles dependen del perfil y los permisos asignados a cada cuenta.',
        ],
      },
      {
        heading: '2. Uso de la cuenta',
        paragraphs: [
          'La cuenta es personal. Cada persona debe mantener la confidencialidad de sus credenciales, cerrar sesiones en dispositivos compartidos y comunicar oportunamente cualquier uso no autorizado al canal institucional que se habilite para este fin.',
        ],
      },
      {
        heading: '3. Uso responsable de la información',
        paragraphs: [
          'La información disponible en MARSYS debe consultarse y utilizarse solo para fines académicos e institucionales autorizados y de acuerdo con los permisos de la cuenta. No se debe intentar acceder a información ajena a esos permisos, alterar registros sin autorización ni divulgar datos personales fuera de los canales institucionales aprobados.',
        ],
      },
      {
        heading: '4. Seguridad y continuidad',
        paragraphs: [
          'La plataforma puede ser actualizada o temporalmente interrumpida para mantención o seguridad. Las personas usuarias deben informar incidentes o vulnerabilidades por el canal institucional definido, sin explotar ni divulgar públicamente el problema.',
        ],
      },
      {
        heading: '5. Privacidad y datos personales',
        paragraphs: [
          'El tratamiento de datos personales se informa en la Política de Privacidad de MARSYS y se rige por la normativa aplicable. La aceptación de estos términos registra la aceptación de las condiciones de uso; no constituye por sí sola consentimiento para tratamientos de datos personales.',
        ],
      },
    ],
  },
  en: {
    locale: 'en',
    title: 'MARSYS Terms of Use',
    notice:
      'Preliminary technical draft. Institutional review and approval are required before production use.',
    sections: [
      {
        heading: '1. Service scope',
        paragraphs: [
          'MARSYS supports academic administration at the Faculty of Marine Sciences of Universidad Católica del Norte. Available functions depend on each account’s profile and assigned permissions.',
        ],
      },
      {
        heading: '2. Account use',
        paragraphs: [
          'Accounts are personal. Users must keep their credentials confidential, sign out on shared devices, and promptly report unauthorized use through the institutional channel established for this purpose.',
        ],
      },
      {
        heading: '3. Responsible use of information',
        paragraphs: [
          'Information available in MARSYS may only be accessed and used for authorized academic and institutional purposes and within the account’s permissions. Users must not attempt to access information outside those permissions, alter records without authorization, or disclose personal data outside approved institutional channels.',
        ],
      },
      {
        heading: '4. Security and continuity',
        paragraphs: [
          'The platform may be updated or temporarily interrupted for maintenance or security. Users should report incidents or vulnerabilities through the designated institutional channel without exploiting or publicly disclosing the issue.',
        ],
      },
      {
        heading: '5. Privacy and personal data',
        paragraphs: [
          'Personal data processing is described in the MARSYS Privacy Policy and governed by applicable law. Accepting these terms records acceptance of the conditions of use; it does not by itself constitute consent to personal data processing.',
        ],
      },
    ],
  },
} as const;

export type TermsLocale = keyof typeof terms;

export function getTerms(locale: string, version = CURRENT_TERMS_VERSION) {
  if (version !== CURRENT_TERMS_VERSION) return null;
  const normalizedLocale: TermsLocale = locale === 'en' ? 'en' : 'es';
  const document = terms[normalizedLocale];
  const contentHash = createHash('sha256')
    .update(JSON.stringify({ version, ...document }))
    .digest('hex');

  return { version, ...document, contentHash };
}
