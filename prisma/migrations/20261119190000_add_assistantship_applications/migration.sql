BEGIN;

CREATE TYPE "AssistantshipApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "AssistantshipApplicationNotification" AS ENUM ('NOT_REQUESTED', 'PENDING', 'SENT', 'FAILED');

CREATE TABLE "AssistantshipApplication" (
    "id" TEXT NOT NULL,
    "piiVersion" INTEGER NOT NULL DEFAULT 0,
    "externalResponseId" TEXT NOT NULL,
    "externalResponseIdHash" TEXT,
    "studentEmail" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "submittedCareer" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "motivation" TEXT NOT NULL,
    "ppa" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "status" "AssistantshipApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "notification" "AssistantshipApplicationNotification" NOT NULL DEFAULT 'NOT_REQUESTED',
    "studentId" TEXT,
    "assistantshipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantshipApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantshipApplication_externalResponseIdHash_key" ON "AssistantshipApplication"("externalResponseIdHash");
CREATE UNIQUE INDEX "AssistantshipApplication_assistantshipId_key" ON "AssistantshipApplication"("assistantshipId");
CREATE INDEX "AssistantshipApplication_status_submittedAt_id_idx" ON "AssistantshipApplication"("status", "submittedAt", "id");
CREATE INDEX "AssistantshipApplication_studentId_idx" ON "AssistantshipApplication"("studentId");

ALTER TABLE "AssistantshipApplication" ADD CONSTRAINT "AssistantshipApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssistantshipApplication" ADD CONSTRAINT "AssistantshipApplication_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssistantshipApplication" ADD CONSTRAINT "AssistantshipApplication_assistantshipId_fkey" FOREIGN KEY ("assistantshipId") REFERENCES "Assistantship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
