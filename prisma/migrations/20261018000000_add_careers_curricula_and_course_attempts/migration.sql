CREATE TYPE "CourseAttemptOutcome" AS ENUM ('PASSED', 'FAILED');

CREATE TABLE "Career" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Career_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CurriculumVersion" (
    "id" TEXT NOT NULL,
    "careerId" TEXT NOT NULL,
    "cohortYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CurriculumVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CurriculumCourse" (
    "id" TEXT NOT NULL,
    "curriculumVersionId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "termNumber" INTEGER NOT NULL,
    CONSTRAINT "CurriculumCourse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentCourseAttempt" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "outcome" "CourseAttemptOutcome" NOT NULL,
    "nrc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentCourseAttempt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Student" ADD COLUMN "careerCurriculumVersionId" TEXT;

CREATE UNIQUE INDEX "Career_code_key" ON "Career"("code");
CREATE UNIQUE INDEX "Career_name_key" ON "Career"("name");
CREATE UNIQUE INDEX "CurriculumVersion_careerId_cohortYear_key" ON "CurriculumVersion"("careerId", "cohortYear");
CREATE INDEX "CurriculumVersion_careerId_idx" ON "CurriculumVersion"("careerId");
CREATE UNIQUE INDEX "CurriculumCourse_curriculumVersionId_courseId_key" ON "CurriculumCourse"("curriculumVersionId", "courseId");
CREATE INDEX "CurriculumCourse_courseId_idx" ON "CurriculumCourse"("courseId");
CREATE UNIQUE INDEX "StudentCourseAttempt_studentId_courseId_attemptNumber_key" ON "StudentCourseAttempt"("studentId", "courseId", "attemptNumber");
CREATE INDEX "StudentCourseAttempt_studentId_semesterId_idx" ON "StudentCourseAttempt"("studentId", "semesterId");
CREATE INDEX "StudentCourseAttempt_courseId_idx" ON "StudentCourseAttempt"("courseId");

ALTER TABLE "Student" ADD CONSTRAINT "Student_careerCurriculumVersionId_fkey" FOREIGN KEY ("careerCurriculumVersionId") REFERENCES "CurriculumVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CurriculumVersion" ADD CONSTRAINT "CurriculumVersion_careerId_fkey" FOREIGN KEY ("careerId") REFERENCES "Career"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CurriculumCourse" ADD CONSTRAINT "CurriculumCourse_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "CurriculumVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CurriculumCourse" ADD CONSTRAINT "CurriculumCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentCourseAttempt" ADD CONSTRAINT "StudentCourseAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentCourseAttempt" ADD CONSTRAINT "StudentCourseAttempt_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "AcademicSemester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentCourseAttempt" ADD CONSTRAINT "StudentCourseAttempt_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
