CREATE UNIQUE INDEX "CurriculumVersion_id_careerId_key" ON "CurriculumVersion"("id", "careerId");

CREATE TABLE "CurriculumCohort" (
    "careerId" TEXT NOT NULL,
    "cohortYear" INTEGER NOT NULL,
    "curriculumVersionId" TEXT NOT NULL,
    CONSTRAINT "CurriculumCohort_pkey" PRIMARY KEY ("careerId", "cohortYear")
);

CREATE INDEX "CurriculumCohort_curriculumVersionId_careerId_idx"
    ON "CurriculumCohort"("curriculumVersionId", "careerId");

ALTER TABLE "CurriculumCohort" ADD CONSTRAINT "CurriculumCohort_curriculumVersionId_careerId_fkey"
    FOREIGN KEY ("curriculumVersionId", "careerId")
    REFERENCES "CurriculumVersion"("id", "careerId") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "CurriculumCohort" ("careerId", "cohortYear", "curriculumVersionId")
SELECT "careerId", "cohortYear", "id" FROM "CurriculumVersion";
