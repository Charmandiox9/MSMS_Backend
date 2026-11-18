BEGIN;

CREATE TYPE "TitulationStage" AS ENUM ('INTAKE', 'REVIEW', 'DEFENSE', 'CLOSED');
CREATE TYPE "TitulationDocumentStatus" AS ENUM ('PENDING', 'RECEIVED', 'PREPARED');

CREATE TABLE "TitulationProcess" (
  "id" TEXT NOT NULL,
  "piiVersion" INTEGER NOT NULL DEFAULT 0,
  "studentName" TEXT NOT NULL,
  "studentRut" TEXT,
  "studentRutHash" TEXT,
  "studentEmail" TEXT,
  "studentEmailHash" TEXT,
  "studentPhone" TEXT,
  "thesisTopic" TEXT NOT NULL,
  "degree" TEXT NOT NULL,
  "careerName" TEXT NOT NULL,
  "careerId" TEXT,
  "guideName" TEXT NOT NULL,
  "coGuideName" TEXT,
  "reviewerOneName" TEXT,
  "reviewerTwoName" TEXT,
  "defenseDate" DATE,
  "stage" "TitulationStage" NOT NULL DEFAULT 'INTAKE',
  "defenseAnnexesStatus" "TitulationDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "thesisSummaryStatus" "TitulationDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "libraryFormStatus" "TitulationDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "actaStatus" "TitulationDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "evaluationsStatus" "TitulationDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TitulationProcess_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TitulationProcess_stage_defenseDate_idx"
  ON "TitulationProcess"("stage", "defenseDate");
CREATE INDEX "TitulationProcess_careerId_stage_idx"
  ON "TitulationProcess"("careerId", "stage");
CREATE INDEX "TitulationProcess_studentRutHash_idx"
  ON "TitulationProcess"("studentRutHash");
CREATE INDEX "TitulationProcess_studentEmailHash_idx"
  ON "TitulationProcess"("studentEmailHash");
CREATE INDEX "TitulationProcess_createdAt_idx"
  ON "TitulationProcess"("createdAt");

ALTER TABLE "TitulationProcess"
  ADD CONSTRAINT "TitulationProcess_careerId_fkey"
  FOREIGN KEY ("careerId") REFERENCES "Career"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TitulationProcess"
  ADD CONSTRAINT "TitulationProcess_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TitulationProcess"
  ADD CONSTRAINT "TitulationProcess_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
