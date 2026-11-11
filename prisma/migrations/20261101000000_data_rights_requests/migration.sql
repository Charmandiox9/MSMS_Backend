BEGIN;

INSERT INTO "Role" (
  "id", "code", "name", "description", "isSystem", "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'PRIVACY_OFFICER',
  'Privacy Officer',
  'Gestiona solicitudes de derechos sobre datos personales',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

CREATE TYPE "DataRightsRequestType" AS ENUM (
  'ACCESS',
  'RECTIFICATION',
  'SUPPRESSION',
  'OPPOSITION',
  'PORTABILITY',
  'BLOCKING'
);

CREATE TYPE "DataRightsRequestStatus" AS ENUM (
  'RECEIVED',
  'VERIFYING',
  'IN_PROGRESS',
  'COMPLETED',
  'DENIED',
  'CLOSED'
);

CREATE TYPE "DataRightsRequestEventType" AS ENUM (
  'SUBMITTED',
  'STATUS_CHANGED',
  'DEADLINE_EXTENDED'
);

CREATE TABLE "DataRightsRequest" (
  "id" TEXT NOT NULL,
  "subjectUserId" TEXT,
  "rightType" "DataRightsRequestType" NOT NULL,
  "status" "DataRightsRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "details" TEXT,
  "responseNote" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "extendedAt" TIMESTAMP(3),
  "extensionNote" TEXT,
  "respondedAt" TIMESTAMP(3),
  "piiVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "DataRightsRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataRightsRequestEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" "DataRightsRequestEventType" NOT NULL,
  "fromStatus" "DataRightsRequestStatus",
  "toStatus" "DataRightsRequestStatus" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataRightsRequestEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataRightsRequest_subjectUserId_createdAt_idx"
  ON "DataRightsRequest"("subjectUserId", "createdAt");
CREATE INDEX "DataRightsRequest_status_dueAt_idx"
  ON "DataRightsRequest"("status", "dueAt");
CREATE UNIQUE INDEX "DataRightsRequest_open_subject_right_key"
  ON "DataRightsRequest"("subjectUserId", "rightType")
  WHERE "subjectUserId" IS NOT NULL
    AND "status" IN ('RECEIVED', 'VERIFYING', 'IN_PROGRESS');
CREATE INDEX "DataRightsRequestEvent_requestId_createdAt_idx"
  ON "DataRightsRequestEvent"("requestId", "createdAt");

ALTER TABLE "DataRightsRequest"
  ADD CONSTRAINT "DataRightsRequest_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DataRightsRequestEvent"
  ADD CONSTRAINT "DataRightsRequestEvent_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "DataRightsRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DataRightsRequestEvent"
  ADD CONSTRAINT "DataRightsRequestEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
