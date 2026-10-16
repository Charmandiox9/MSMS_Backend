CREATE TYPE "AcademicImportType" AS ENUM ('PROJECTS', 'RESEARCH', 'HOURLY');

CREATE TYPE "AcademicImportStatus" AS ENUM (
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE "AcademicImportJob" (
  "id" TEXT NOT NULL,
  "type" "AcademicImportType" NOT NULL,
  "status" "AcademicImportStatus" NOT NULL DEFAULT 'QUEUED',
  "payload" TEXT,
  "result" JSONB,
  "error" TEXT,
  "requestedById" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcademicImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AcademicImportJob_status_createdAt_idx"
  ON "AcademicImportJob"("status", "createdAt");

CREATE INDEX "AcademicImportJob_requestedById_createdAt_idx"
  ON "AcademicImportJob"("requestedById", "createdAt");
