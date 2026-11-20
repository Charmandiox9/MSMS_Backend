-- CreateEnum
CREATE TYPE "TitulationOutcome" AS ENUM ('UNCONFIRMED', 'IN_PROGRESS', 'GRADUATED', 'NOT_GRADUATED');

-- AlterTable
ALTER TABLE "TitulationProcess" ADD COLUMN     "outcome" "TitulationOutcome" NOT NULL DEFAULT 'IN_PROGRESS';

UPDATE "TitulationProcess" SET "outcome" = 'GRADUATED' WHERE "source" = 'LEGACY_ACCESS';

-- CreateIndex
CREATE INDEX "TitulationProcess_outcome_stage_idx" ON "TitulationProcess"("outcome", "stage");
