-- AlterTable
ALTER TABLE "TeachingAssistant" ADD COLUMN     "studentId" TEXT;

-- AlterTable
ALTER TABLE "Assistantship" ADD COLUMN     "careerId" TEXT,
ADD COLUMN     "courseNrc" TEXT,
ADD COLUMN     "semesterId" TEXT,
ALTER COLUMN "teachingAssignmentId" DROP NOT NULL;

-- Preserve all existing periods and course NRCs before requiring the semester.
UPDATE "Assistantship" AS a SET "semesterId" = t."semesterId", "courseNrc" = t.nrc
FROM "TeachingAssignment" AS t WHERE a."teachingAssignmentId" = t.id;
ALTER TABLE "Assistantship" ALTER COLUMN "semesterId" SET NOT NULL;

CREATE UNIQUE INDEX "Assistantship_historical_course_student_nrc_key"
ON "Assistantship" ("semesterId", "courseId", "assistantId", COALESCE("courseNrc", ''))
WHERE "teachingAssignmentId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssistant_studentId_key" ON "TeachingAssistant"("studentId");

-- CreateIndex
CREATE INDEX "Assistantship_semesterId_courseId_idx" ON "Assistantship"("semesterId", "courseId");

-- AddForeignKey
ALTER TABLE "TeachingAssistant" ADD CONSTRAINT "TeachingAssistant_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assistantship" ADD CONSTRAINT "Assistantship_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "AcademicSemester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assistantship" ADD CONSTRAINT "Assistantship_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assistantship" ADD CONSTRAINT "Assistantship_careerId_fkey" FOREIGN KEY ("careerId") REFERENCES "Career"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
