CREATE TABLE "CourseSchedule" (
    "id" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "nrc" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseSchedule_semesterId_nrc_day_block_key" ON "CourseSchedule"("semesterId", "nrc", "day", "block");
CREATE INDEX "CourseSchedule_semesterId_idx" ON "CourseSchedule"("semesterId");
CREATE INDEX "CourseSchedule_nrc_idx" ON "CourseSchedule"("nrc");

ALTER TABLE "CourseSchedule" ADD CONSTRAINT "CourseSchedule_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "AcademicSemester"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseSchedule" ADD CONSTRAINT "CourseSchedule_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
