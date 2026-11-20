CREATE TYPE "SemesterBudgetCategoryCode" AS ENUM ('HOURLY_TEACHERS', 'ASSISTANTSHIPS');

ALTER TABLE "SemesterBudgetAllocation" ADD COLUMN "code" "SemesterBudgetCategoryCode";
UPDATE "SemesterBudgetAllocation" SET "code" = 'ASSISTANTSHIPS'
WHERE lower("name") IN ('ayudantías', 'ayudantias', 'assistantships');
UPDATE "SemesterBudgetAllocation" SET "code" = 'HOURLY_TEACHERS'
WHERE lower("name") IN ('profesores por hora', 'hourly teachers');
CREATE UNIQUE INDEX "SemesterBudgetAllocation_budgetId_code_key" ON "SemesterBudgetAllocation"("budgetId", "code");

CREATE TABLE "AssistantshipTariff" (
    "id" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "monthlyRateClp" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssistantshipTariff_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Assistantship" ADD COLUMN "tariffId" TEXT;
ALTER TABLE "Assistantship" ADD COLUMN "tariffRateClp" DECIMAL(12,2);

CREATE UNIQUE INDEX "AssistantshipTariff_id_semesterId_key" ON "AssistantshipTariff"("id", "semesterId");
CREATE UNIQUE INDEX "AssistantshipTariff_semesterId_name_key" ON "AssistantshipTariff"("semesterId", "name");
CREATE INDEX "AssistantshipTariff_semesterId_idx" ON "AssistantshipTariff"("semesterId");

ALTER TABLE "AssistantshipTariff" ADD CONSTRAINT "AssistantshipTariff_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "AcademicSemester"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assistantship" ADD CONSTRAINT "Assistantship_tariffId_semesterId_fkey" FOREIGN KEY ("tariffId", "semesterId") REFERENCES "AssistantshipTariff"("id", "semesterId") ON DELETE RESTRICT ON UPDATE CASCADE;
