CREATE TYPE "JustificationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
CREATE TYPE "JustificationInboxStatus" AS ENUM ('UNREAD', 'READ');

CREATE TABLE "AcademicSemester" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsOn" TIMESTAMP(3) NOT NULL,
  "endsOn" TIMESTAMP(3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcademicSemester_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Teacher" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "employeeCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Course" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TeachingAssignment" (
  "id" TEXT NOT NULL,
  "semesterId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "parallel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeachingAssignment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "JustificationInbox" (
  "id" TEXT NOT NULL,
  "externalResponseId" TEXT NOT NULL,
  "studentEmail" TEXT NOT NULL,
  "absenceDate" TIMESTAMP(3) NOT NULL,
  "subjectName" TEXT NOT NULL,
  "subjectCode" TEXT,
  "parallel" TEXT,
  "reason" TEXT,
  "evidenceKey" TEXT NOT NULL,
  "evidenceContentType" TEXT NOT NULL,
  "status" "JustificationInboxStatus" NOT NULL DEFAULT 'UNREAD',
  "readAt" TIMESTAMP(3),
  "justificationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JustificationInbox_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Justification" (
  "id" TEXT NOT NULL,
  "sourceResponseId" TEXT NOT NULL,
  "studentEmail" TEXT NOT NULL,
  "absenceDate" TIMESTAMP(3) NOT NULL,
  "subjectName" TEXT NOT NULL,
  "subjectCode" TEXT,
  "parallel" TEXT,
  "reason" TEXT,
  "evidenceKey" TEXT NOT NULL,
  "evidenceContentType" TEXT NOT NULL,
  "status" "JustificationStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "decidedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Justification_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "JustificationStatusHistory" (
  "id" TEXT NOT NULL,
  "justificationId" TEXT NOT NULL,
  "fromStatus" "JustificationStatus",
  "toStatus" "JustificationStatus" NOT NULL,
  "note" TEXT,
  "changedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JustificationStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Teacher_email_key" ON "Teacher"("email");
CREATE UNIQUE INDEX "Teacher_employeeCode_key" ON "Teacher"("employeeCode");
CREATE UNIQUE INDEX "Course_code_name_key" ON "Course"("code", "name");
CREATE UNIQUE INDEX "TeachingAssignment_unique" ON "TeachingAssignment"("semesterId", "teacherId", "courseId", "parallel");
CREATE UNIQUE INDEX "JustificationInbox_externalResponseId_key" ON "JustificationInbox"("externalResponseId");
CREATE UNIQUE INDEX "JustificationInbox_justificationId_key" ON "JustificationInbox"("justificationId");
CREATE UNIQUE INDEX "Justification_sourceResponseId_key" ON "Justification"("sourceResponseId");
CREATE INDEX "AcademicSemester_isActive_idx" ON "AcademicSemester"("isActive");
CREATE INDEX "TeachingAssignment_semesterId_idx" ON "TeachingAssignment"("semesterId");
CREATE INDEX "TeachingAssignment_teacherId_idx" ON "TeachingAssignment"("teacherId");
CREATE INDEX "JustificationInbox_status_createdAt_idx" ON "JustificationInbox"("status", "createdAt");
CREATE INDEX "Justification_status_createdAt_idx" ON "Justification"("status", "createdAt");
CREATE INDEX "Justification_studentEmail_idx" ON "Justification"("studentEmail");
CREATE INDEX "JustificationStatusHistory_justificationId_createdAt_idx" ON "JustificationStatusHistory"("justificationId", "createdAt");

ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "AcademicSemester"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JustificationInbox" ADD CONSTRAINT "JustificationInbox_justificationId_fkey" FOREIGN KEY ("justificationId") REFERENCES "Justification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Justification" ADD CONSTRAINT "Justification_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Justification" ADD CONSTRAINT "Justification_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JustificationStatusHistory" ADD CONSTRAINT "JustificationStatusHistory_justificationId_fkey" FOREIGN KEY ("justificationId") REFERENCES "Justification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JustificationStatusHistory" ADD CONSTRAINT "JustificationStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
