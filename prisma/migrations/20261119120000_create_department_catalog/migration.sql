BEGIN;

CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- Preserve each explicit assignment with its existing identifier and label.
INSERT INTO "Department" ("id", "name", "updatedAt")
SELECT "id", "name", CURRENT_TIMESTAMP
FROM "Career"
WHERE "id" IN (
    SELECT "departmentId" FROM "Project"
    UNION
    SELECT "departmentId" FROM "ResearchOutput"
);

ALTER TABLE "Career" ADD COLUMN "departmentId" TEXT;
CREATE INDEX "Career_departmentId_idx" ON "Career"("departmentId");
ALTER TABLE "Career" ADD CONSTRAINT "Career_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Project" DROP CONSTRAINT "Project_departmentId_fkey";
ALTER TABLE "Project" ADD CONSTRAINT "Project_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "ResearchOutput" DROP CONSTRAINT "ResearchOutput_departmentId_fkey";
ALTER TABLE "ResearchOutput" ADD CONSTRAINT "ResearchOutput_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT;
