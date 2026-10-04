ALTER TABLE "TeachingAssignment" ADD COLUMN "nrc" TEXT NOT NULL DEFAULT '';
ALTER TABLE "JustificationInbox" ADD COLUMN "nrc" TEXT;
ALTER TABLE "Justification" ADD COLUMN "nrc" TEXT;

-- Preserve the identity of historical assignments while new imports use real NRCs.
UPDATE "TeachingAssignment"
SET "nrc" = CASE
  WHEN NULLIF(BTRIM("parallel"), '') IS NOT NULL THEN BTRIM("parallel")
  ELSE "id"
END;

DROP INDEX "TeachingAssignment_unique";
CREATE UNIQUE INDEX "TeachingAssignment_semesterId_teacherId_courseId_nrc_key" ON "TeachingAssignment"("semesterId", "teacherId", "courseId", "nrc");
CREATE INDEX "TeachingAssignment_nrc_idx" ON "TeachingAssignment"("nrc");
