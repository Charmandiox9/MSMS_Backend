-- AlterTable
ALTER TABLE "Teacher" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "joinedOn" DATE,
ADD COLUMN     "leftOn" DATE;

-- CreateTable
CREATE TABLE "TeachingAssistant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "studentCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingAssistant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantCourseApproval" (
    "assistantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "approvedOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantCourseApproval_pkey" PRIMARY KEY ("assistantId","courseId")
);

-- CreateTable
CREATE TABLE "Assistantship" (
    "id" TEXT NOT NULL,
    "teachingAssignmentId" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "approvedOn" DATE NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "weeklyHours" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assistantship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantshipSchedule" (
    "id" TEXT NOT NULL,
    "assistantshipId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startsAtMinute" INTEGER NOT NULL,
    "endsAtMinute" INTEGER NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantshipSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssistant_email_key" ON "TeachingAssistant"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssistant_studentCode_key" ON "TeachingAssistant"("studentCode");

-- CreateIndex
CREATE INDEX "AssistantCourseApproval_courseId_idx" ON "AssistantCourseApproval"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantCourseApproval_assistantId_courseId_approvedOn_key" ON "AssistantCourseApproval"("assistantId", "courseId", "approvedOn");

-- CreateIndex
CREATE INDEX "Assistantship_assistantId_courseId_approvedOn_idx" ON "Assistantship"("assistantId", "courseId", "approvedOn");

-- CreateIndex
CREATE INDEX "Assistantship_teachingAssignmentId_courseId_idx" ON "Assistantship"("teachingAssignmentId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Assistantship_teachingAssignmentId_assistantId_key" ON "Assistantship"("teachingAssignmentId", "assistantId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantshipSchedule_assistantshipId_weekday_startsAtMinut_key" ON "AssistantshipSchedule"("assistantshipId", "weekday", "startsAtMinute", "endsAtMinute");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssignment_id_courseId_key" ON "TeachingAssignment"("id", "courseId");

-- AddForeignKey
ALTER TABLE "AssistantCourseApproval" ADD CONSTRAINT "AssistantCourseApproval_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "TeachingAssistant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantCourseApproval" ADD CONSTRAINT "AssistantCourseApproval_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assistantship" ADD CONSTRAINT "Assistantship_teachingAssignmentId_courseId_fkey" FOREIGN KEY ("teachingAssignmentId", "courseId") REFERENCES "TeachingAssignment"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assistantship" ADD CONSTRAINT "Assistantship_assistantId_courseId_approvedOn_fkey" FOREIGN KEY ("assistantId", "courseId", "approvedOn") REFERENCES "AssistantCourseApproval"("assistantId", "courseId", "approvedOn") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantshipSchedule" ADD CONSTRAINT "AssistantshipSchedule_assistantshipId_fkey" FOREIGN KEY ("assistantshipId") REFERENCES "Assistantship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma cannot express CHECK constraints. Keep these validations in PostgreSQL.
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_employment_dates_check"
    CHECK ("leftOn" IS NULL OR "joinedOn" IS NULL OR "leftOn" >= "joinedOn");

ALTER TABLE "Assistantship" ADD CONSTRAINT "Assistantship_dates_check"
    CHECK ("startsOn" > "approvedOn" AND ("endsOn" IS NULL OR "endsOn" >= "startsOn"));

ALTER TABLE "Assistantship" ADD CONSTRAINT "Assistantship_weekly_hours_check"
    CHECK ("weeklyHours" IS NULL OR ("weeklyHours" > 0 AND "weeklyHours" <= 168));

ALTER TABLE "AssistantshipSchedule" ADD CONSTRAINT "AssistantshipSchedule_time_range_check"
    CHECK ("weekday" BETWEEN 1 AND 7 AND "startsAtMinute" >= 0
        AND "endsAtMinute" <= 1440 AND "startsAtMinute" < "endsAtMinute");
