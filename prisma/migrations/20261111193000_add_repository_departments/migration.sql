-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "departmentId" TEXT;

-- AlterTable
ALTER TABLE "ResearchOutput" ADD COLUMN     "departmentId" TEXT;

-- CreateIndex
CREATE INDEX "Project_departmentId_idx" ON "Project"("departmentId");

-- CreateIndex
CREATE INDEX "ResearchOutput_departmentId_idx" ON "ResearchOutput"("departmentId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Career"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchOutput" ADD CONSTRAINT "ResearchOutput_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Career"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
