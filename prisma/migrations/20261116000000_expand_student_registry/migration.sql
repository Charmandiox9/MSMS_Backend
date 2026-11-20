ALTER TABLE "Career" ALTER COLUMN "code" DROP NOT NULL;

ALTER TABLE "Student"
ADD COLUMN "rut" TEXT,
ADD COLUMN "rutHash" TEXT,
ADD COLUMN "givenNames" TEXT,
ADD COLUMN "personalEmail" TEXT,
ADD COLUMN "admission" INTEGER,
ADD COLUMN "paternalSurname" TEXT,
ADD COLUMN "maternalSurname" TEXT,
ADD COLUMN "birthDate" TEXT,
ADD COLUMN "careerId" TEXT;

CREATE UNIQUE INDEX "Student_rutHash_key" ON "Student"("rutHash");
CREATE INDEX "Student_careerId_idx" ON "Student"("careerId");
ALTER TABLE "Student" ADD CONSTRAINT "Student_careerId_fkey"
FOREIGN KEY ("careerId") REFERENCES "Career"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "Student" AS student
SET "careerId" = curriculum."careerId"
FROM "CurriculumVersion" AS curriculum
WHERE student."careerCurriculumVersionId" = curriculum."id";
