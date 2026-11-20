import { Prisma } from '@prisma/client';

export const TITULATION_REVIEW_WHERE: Prisma.TitulationProcessWhereInput = {
  OR: [
    { outcome: 'UNCONFIRMED' },
    { studentId: null },
    { studentRut: null },
    { studentEmail: null },
    { studentPhone: null },
    { defenseDate: null },
    { degree: null },
    { thesisTopic: null },
    { guideName: null },
    { reviewerOneName: null },
    { reviewerTwoName: null },
    { defenseAnnexesStatus: 'UNVERIFIED' },
    { thesisSummaryStatus: 'UNVERIFIED' },
    { libraryFormStatus: 'UNVERIFIED' },
    { actaStatus: 'UNVERIFIED' },
    { evaluationsStatus: 'UNVERIFIED' },
  ],
};

export function titulationViewWhere(
  view?: string,
): Prisma.TitulationProcessWhereInput {
  if (view === 'REVIEW') return TITULATION_REVIEW_WHERE;
  if (view === 'ACTIVE') return { outcome: 'IN_PROGRESS' };
  if (view === 'GRADUATED') return { outcome: 'GRADUATED' };
  return {};
}
