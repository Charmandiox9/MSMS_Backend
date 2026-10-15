-- AlterTable
ALTER TABLE "JustificationInbox" ADD COLUMN     "studentId" TEXT;

-- AlterTable
ALTER TABLE "Justification" ADD COLUMN     "studentId" TEXT;

-- CreateIndex
CREATE INDEX "JustificationInbox_studentId_idx" ON "JustificationInbox"("studentId");

-- CreateIndex
CREATE INDEX "Justification_studentId_idx" ON "Justification"("studentId");

-- AddForeignKey
ALTER TABLE "JustificationInbox" ADD CONSTRAINT "JustificationInbox_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Justification" ADD CONSTRAINT "Justification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
