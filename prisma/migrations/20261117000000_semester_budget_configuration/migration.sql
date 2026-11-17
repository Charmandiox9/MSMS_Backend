CREATE TABLE "SemesterBudget" (
    "id" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "totalAmountClp" DECIMAL(14,0) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SemesterBudget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SemesterBudgetAllocation" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "amountClp" DECIMAL(14,0) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SemesterBudgetAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SemesterBudgetThreshold" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "percentage" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SemesterBudgetThreshold_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SemesterBudgetThresholdRole" (
    "thresholdId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SemesterBudgetThresholdRole_pkey" PRIMARY KEY ("thresholdId", "roleId")
);

CREATE UNIQUE INDEX "SemesterBudget_semesterId_key" ON "SemesterBudget"("semesterId");
CREATE INDEX "SemesterBudgetAllocation_budgetId_idx" ON "SemesterBudgetAllocation"("budgetId");
CREATE UNIQUE INDEX "SemesterBudgetAllocation_budgetId_name_key" ON "SemesterBudgetAllocation"("budgetId", "name");
CREATE INDEX "SemesterBudgetThreshold_budgetId_idx" ON "SemesterBudgetThreshold"("budgetId");
CREATE UNIQUE INDEX "SemesterBudgetThreshold_budgetId_percentage_key" ON "SemesterBudgetThreshold"("budgetId", "percentage");
CREATE INDEX "SemesterBudgetThresholdRole_roleId_idx" ON "SemesterBudgetThresholdRole"("roleId");

ALTER TABLE "SemesterBudget" ADD CONSTRAINT "SemesterBudget_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "AcademicSemester"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SemesterBudgetAllocation" ADD CONSTRAINT "SemesterBudgetAllocation_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "SemesterBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SemesterBudgetThreshold" ADD CONSTRAINT "SemesterBudgetThreshold_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "SemesterBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SemesterBudgetThresholdRole" ADD CONSTRAINT "SemesterBudgetThresholdRole_thresholdId_fkey" FOREIGN KEY ("thresholdId") REFERENCES "SemesterBudgetThreshold"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SemesterBudgetThresholdRole" ADD CONSTRAINT "SemesterBudgetThresholdRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
