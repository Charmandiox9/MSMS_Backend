-- AlterTable
ALTER TABLE "Student" ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TitulationProcess" ADD COLUMN     "studentId" TEXT;

-- CreateIndex
CREATE INDEX "TitulationProcess_studentId_idx" ON "TitulationProcess"("studentId");

-- AddForeignKey
ALTER TABLE "TitulationProcess" ADD CONSTRAINT "TitulationProcess_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
