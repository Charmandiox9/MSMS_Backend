import { DataRightsRequestStatus } from '@prisma/client';

export const OPEN_DATA_RIGHTS_STATUSES = [
  DataRightsRequestStatus.RECEIVED,
  DataRightsRequestStatus.VERIFYING,
  DataRightsRequestStatus.IN_PROGRESS,
] as const;
