export interface PiiPolicy {
  fields: readonly string[];
  lookups: Readonly<Record<string, string>>;
  searchable: readonly string[];
  compoundLookups?: Readonly<Record<string, string>>;
}

/** Direct identifiers and free text; typed academic/financial data also require encrypted infrastructure. */
export const piiPolicies: Readonly<Record<string, PiiPolicy>> = {
  User: {
    fields: ['name', 'email', 'googleId', 'avatarUrl'],
    lookups: { email: 'emailHash', googleId: 'googleIdHash' },
    searchable: ['name', 'email'],
  },
  DataRightsRequest: {
    fields: ['details', 'responseNote', 'extensionNote'],
    lookups: {},
    searchable: [],
  },
  PreloadedUser: {
    fields: ['email'],
    lookups: { email: 'emailHash' },
    searchable: ['email'],
  },
  Teacher: {
    fields: [
      'name',
      'email',
      'employeeCode',
      'rut',
      'academicUnit',
      'professionalTitle',
      'institution',
    ],
    lookups: {
      email: 'emailHash',
      employeeCode: 'employeeCodeHash',
      rut: 'rutHash',
    },
    searchable: ['name', 'email', 'employeeCode', 'rut'],
  },
  Student: {
    fields: [
      'name',
      'email',
      'givenNames',
      'rut',
      'personalEmail',
      'paternalSurname',
      'maternalSurname',
      'birthDate',
      'admission',
    ],
    lookups: { email: 'emailHash', rut: 'rutHash' },
    searchable: [
      'name',
      'email',
      'givenNames',
      'rut',
      'personalEmail',
      'paternalSurname',
      'maternalSurname',
      'admission',
    ],
  },
  TitulationProcess: {
    fields: [
      'studentName',
      'studentRut',
      'studentEmail',
      'studentPhone',
      'thesisTopic',
      'degree',
      'guideName',
      'coGuideName',
      'reviewerOneName',
      'reviewerTwoName',
    ],
    lookups: {
      studentRut: 'studentRutHash',
      studentEmail: 'studentEmailHash',
    },
    searchable: [
      'studentName',
      'studentRut',
      'studentEmail',
      'thesisTopic',
      'guideName',
      'coGuideName',
      'reviewerOneName',
      'reviewerTwoName',
    ],
  },
  TeachingAssistant: {
    fields: ['name', 'email', 'studentCode'],
    lookups: { email: 'emailHash', studentCode: 'studentCodeHash' },
    searchable: ['name', 'email', 'studentCode'],
  },
  JustificationInbox: {
    fields: [
      'studentEmail',
      'reason',
      'reasonCategory',
      'evidenceKey',
      'externalResponseId',
    ],
    lookups: {
      externalResponseId: 'externalResponseIdHash',
      studentEmail: 'studentEmailHash',
    },
    searchable: [],
  },
  Justification: {
    fields: [
      'studentEmail',
      'reason',
      'reasonCategory',
      'rejectionReason',
      'evidenceKey',
      'sourceResponseId',
    ],
    lookups: {
      sourceResponseId: 'sourceResponseIdHash',
      studentEmail: 'studentEmailHash',
    },
    searchable: [],
  },
  JustificationStatusHistory: { fields: ['note'], lookups: {}, searchable: [] },
  Project: { fields: ['notes', 'folderUrl'], lookups: {}, searchable: [] },
  ProjectParticipant: {
    fields: ['name', 'contactEmail', 'gender'],
    lookups: { name: 'nameHash' },
    compoundLookups: { projectId_name_role: 'projectId_nameHash_role' },
    searchable: ['name', 'contactEmail'],
  },
  Research: { fields: ['description'], lookups: {}, searchable: [] },
  ResearchParticipant: {
    fields: ['name'],
    lookups: { name: 'nameHash' },
    compoundLookups: { researchId_name_role: 'researchId_nameHash_role' },
    searchable: ['name'],
  },
  ResearchOutput: { fields: ['notes'], lookups: {}, searchable: [] },
  ResearchOutputAuthor: {
    fields: ['name', 'affiliation'],
    lookups: {},
    searchable: ['name'],
  },
};

export function normalizePiiLookup(field: string, value: string): string {
  if (field.toLowerCase().includes('rut')) {
    const normalized = value.replace(/[.\s-]/g, '').toUpperCase();
    const parts = normalized.match(/^(\d{7,8})([\dK])$/);
    return parts ? `${parts[1]}-${parts[2]}` : normalized;
  }
  if (field.toLowerCase().includes('email')) return value.trim().toLowerCase();
  return value.trim();
}

export const normalizePiiSearch = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim();
