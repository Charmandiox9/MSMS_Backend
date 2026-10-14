BEGIN;

-- CreateEnum
CREATE TYPE "AcademicDegree" AS ENUM ('PROFESSIONAL', 'MASTER', 'DOCTOR', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "TeacherCertification" AS ENUM ('NONE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3');

-- CreateEnum
CREATE TYPE "HourlyTeacherCategory" AS ENUM ('NEW', 'EXISTING', 'DIVING_PRINCIPAL', 'DIVING_SECONDARY');

-- CreateEnum
CREATE TYPE "TeachingComponent" AS ENUM ('LECTURE', 'WORKSHOP', 'LABORATORY', 'FIELDWORK', 'ASSISTANTSHIP');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('REGISTERED', 'AWARDED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResearchOutputKind" AS ENUM ('ARTICLE', 'BOOK', 'BOOK_CHAPTER', 'INTELLECTUAL_PROPERTY');

-- AlterTable
-- Neon may already contain this nullable legacy TEXT column outside migration history.
-- Preserve recognized values; an incompatible value aborts the whole transaction.
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "academicDegree" "AcademicDegree",
ADD COLUMN     "academicUnit" TEXT,
ADD COLUMN     "certification" "TeacherCertification",
ADD COLUMN     "rut" TEXT;
ALTER TABLE "Teacher" ALTER COLUMN "academicDegree" TYPE "AcademicDegree"
USING "academicDegree"::text::"AcademicDegree";

-- CreateTable
CREATE TABLE "HourlyPayRate" (
    "id" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "category" "HourlyTeacherCategory" NOT NULL,
    "academicDegree" "AcademicDegree" NOT NULL,
    "certification" "TeacherCertification" NOT NULL,
    "hourlyRateClp" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HourlyPayRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyTeachingContract" (
    "id" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "teachingAssignmentId" TEXT NOT NULL,
    "payRateId" TEXT NOT NULL,
    "component" "TeachingComponent" NOT NULL,
    "parallel" TEXT NOT NULL,
    "directHours" DECIMAL(5,2) NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "hourlyRateClp" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HourlyTeachingContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "reportingYear" INTEGER NOT NULL,
    "academicUnit" TEXT NOT NULL,
    "faculty" TEXT,
    "resolution" TEXT,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "classification" TEXT,
    "fundingSource" TEXT,
    "program" TEXT,
    "competition" TEXT,
    "applicationArea" TEXT,
    "participationScope" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'REGISTERED',
    "officialized" BOOLEAN,
    "startsOn" DATE,
    "endsOn" DATE,
    "revisedEndsOn" DATE,
    "closedOn" DATE,
    "currency" TEXT,
    "totalAmount" DECIMAL(18,2),
    "vraContribution" DECIMAL(18,2),
    "vridtContribution" DECIMAL(18,2),
    "recoveryAmount" DECIMAL(18,2),
    "facultyContribution" DECIMAL(18,2),
    "depreciationAmount" DECIMAL(18,2),
    "profitabilityAmount" DECIMAL(18,2),
    "folderUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectParticipant" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "teacherId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contactEmail" TEXT,
    "gender" TEXT,

    CONSTRAINT "ProjectParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Research" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "academicUnit" TEXT NOT NULL,
    "researchArea" TEXT,
    "startsOn" DATE,
    "endsOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Research_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchParticipant" (
    "id" TEXT NOT NULL,
    "researchId" TEXT NOT NULL,
    "teacherId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "ResearchParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchOutput" (
    "id" TEXT NOT NULL,
    "researchId" TEXT,
    "kind" "ResearchOutputKind" NOT NULL,
    "reportingYear" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "doi" TEXT,
    "journal" TEXT,
    "issn" TEXT,
    "isbn" TEXT,
    "quartile" TEXT,
    "fiveYearImpactFactor" DECIMAL(10,4),
    "publicationDate" DATE,
    "indexation" TEXT,
    "publisher" TEXT,
    "publicationPlace" TEXT,
    "studentParticipation" BOOLEAN,
    "internationalParticipation" BOOLEAN,
    "intellectualPropertyType" TEXT,
    "phase" TEXT,
    "phaseDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchOutputAuthor" (
    "id" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "teacherId" TEXT,
    "studentId" TEXT,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "affiliation" TEXT,
    "isStudent" BOOLEAN,

    CONSTRAINT "ResearchOutputAuthor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchOutputProject" (
    "outputId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "ResearchOutputProject_pkey" PRIMARY KEY ("outputId","projectId")
);

-- CreateIndex
CREATE UNIQUE INDEX "HourlyPayRate_id_semesterId_key" ON "HourlyPayRate"("id", "semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyPayRate_semesterId_category_academicDegree_certificat_key" ON "HourlyPayRate"("semesterId", "category", "academicDegree", "certification");

-- CreateIndex
CREATE INDEX "HourlyTeachingContract_semesterId_idx" ON "HourlyTeachingContract"("semesterId");

-- CreateIndex
CREATE INDEX "HourlyTeachingContract_payRateId_semesterId_idx" ON "HourlyTeachingContract"("payRateId", "semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyTeachingContract_teachingAssignmentId_component_paral_key" ON "HourlyTeachingContract"("teachingAssignmentId", "component", "parallel");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "Project_reportingYear_academicUnit_idx" ON "Project"("reportingYear", "academicUnit");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "ProjectParticipant_teacherId_idx" ON "ProjectParticipant"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectParticipant_projectId_name_role_key" ON "ProjectParticipant"("projectId", "name", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Research_projectId_key" ON "Research"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Research_code_key" ON "Research"("code");

-- CreateIndex
CREATE INDEX "Research_academicUnit_idx" ON "Research"("academicUnit");

-- CreateIndex
CREATE INDEX "ResearchParticipant_teacherId_idx" ON "ResearchParticipant"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchParticipant_researchId_name_role_key" ON "ResearchParticipant"("researchId", "name", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchOutput_doi_key" ON "ResearchOutput"("doi");

-- CreateIndex
CREATE INDEX "ResearchOutput_reportingYear_kind_idx" ON "ResearchOutput"("reportingYear", "kind");

-- CreateIndex
CREATE INDEX "ResearchOutput_researchId_idx" ON "ResearchOutput"("researchId");

-- CreateIndex
CREATE INDEX "ResearchOutputAuthor_teacherId_idx" ON "ResearchOutputAuthor"("teacherId");

-- CreateIndex
CREATE INDEX "ResearchOutputAuthor_studentId_idx" ON "ResearchOutputAuthor"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchOutputAuthor_outputId_position_key" ON "ResearchOutputAuthor"("outputId", "position");

-- CreateIndex
CREATE INDEX "ResearchOutputProject_projectId_idx" ON "ResearchOutputProject"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_rut_key" ON "Teacher"("rut");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssignment_id_semesterId_key" ON "TeachingAssignment"("id", "semesterId");

-- AddForeignKey
ALTER TABLE "HourlyPayRate" ADD CONSTRAINT "HourlyPayRate_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "AcademicSemester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyTeachingContract" ADD CONSTRAINT "HourlyTeachingContract_teachingAssignmentId_semesterId_fkey" FOREIGN KEY ("teachingAssignmentId", "semesterId") REFERENCES "TeachingAssignment"("id", "semesterId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyTeachingContract" ADD CONSTRAINT "HourlyTeachingContract_payRateId_semesterId_fkey" FOREIGN KEY ("payRateId", "semesterId") REFERENCES "HourlyPayRate"("id", "semesterId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectParticipant" ADD CONSTRAINT "ProjectParticipant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectParticipant" ADD CONSTRAINT "ProjectParticipant_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Research" ADD CONSTRAINT "Research_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchParticipant" ADD CONSTRAINT "ResearchParticipant_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "Research"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchParticipant" ADD CONSTRAINT "ResearchParticipant_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchOutput" ADD CONSTRAINT "ResearchOutput_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "Research"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchOutputAuthor" ADD CONSTRAINT "ResearchOutputAuthor_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "ResearchOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchOutputAuthor" ADD CONSTRAINT "ResearchOutputAuthor_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchOutputAuthor" ADD CONSTRAINT "ResearchOutputAuthor_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchOutputProject" ADD CONSTRAINT "ResearchOutputProject_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "ResearchOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchOutputProject" ADD CONSTRAINT "ResearchOutputProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity rules supplement the Prisma types; unknown amounts remain NULL.
ALTER TABLE "HourlyPayRate" ADD CONSTRAINT "HourlyPayRate_positive_amount" CHECK ("hourlyRateClp" > 0);
ALTER TABLE "HourlyPayRate" ADD CONSTRAINT "HourlyPayRate_category_qualification" CHECK (
  (("category" IN ('DIVING_PRINCIPAL', 'DIVING_SECONDARY')) = ("academicDegree" = 'NOT_APPLICABLE'))
  AND ("category" = 'EXISTING' OR "certification" = 'NONE')
);
ALTER TABLE "HourlyTeachingContract" ADD CONSTRAINT "HourlyTeachingContract_valid_period_hours" CHECK (
  "startsOn" <= "endsOn" AND "directHours" > 0 AND "directHours" <= 168 AND "hourlyRateClp" > 0 AND length(trim("parallel")) > 0
);
ALTER TABLE "Project" ADD CONSTRAINT "Project_valid_dates" CHECK (
  ("startsOn" IS NULL OR "endsOn" IS NULL OR "startsOn" <= "endsOn")
  AND ("startsOn" IS NULL OR "revisedEndsOn" IS NULL OR "startsOn" <= "revisedEndsOn")
  AND ("startsOn" IS NULL OR "closedOn" IS NULL OR "startsOn" <= "closedOn")
);
ALTER TABLE "Project" ADD CONSTRAINT "Project_currency_for_amounts" CHECK (
  ("totalAmount" IS NULL AND "vraContribution" IS NULL AND "vridtContribution" IS NULL AND "recoveryAmount" IS NULL AND "facultyContribution" IS NULL AND "depreciationAmount" IS NULL AND "profitabilityAmount" IS NULL)
  OR ("currency" IS NOT NULL AND "currency" ~ '^[A-Z]{3}$')
);
ALTER TABLE "Project" ADD CONSTRAINT "Project_nonnegative_amounts" CHECK (
  "totalAmount" >= 0 AND "vraContribution" >= 0 AND "vridtContribution" >= 0 AND "recoveryAmount" >= 0 AND "facultyContribution" >= 0 AND "depreciationAmount" >= 0 AND "profitabilityAmount" >= 0
);
ALTER TABLE "Research" ADD CONSTRAINT "Research_valid_dates" CHECK ("startsOn" IS NULL OR "endsOn" IS NULL OR "startsOn" <= "endsOn");
ALTER TABLE "ResearchOutput" ADD CONSTRAINT "ResearchOutput_valid_impact" CHECK ("fiveYearImpactFactor" >= 0);
ALTER TABLE "ResearchOutputAuthor" ADD CONSTRAINT "ResearchOutputAuthor_valid_identity" CHECK ("position" > 0 AND NOT ("teacherId" IS NOT NULL AND "studentId" IS NOT NULL));

-- Initial configuration from Hoja 3 of Planilla pagos PH 202620.xlsx.
-- Only the active semester is initialized; no personal records are imported.
INSERT INTO "HourlyPayRate" ("id", "semesterId", "category", "academicDegree", "certification", "hourlyRateClp", "updatedAt")
SELECT gen_random_uuid()::text, s."id", r.category::"HourlyTeacherCategory", r.degree::"AcademicDegree", r.certification::"TeacherCertification", r.amount, CURRENT_TIMESTAMP
FROM "AcademicSemester" s
CROSS JOIN (VALUES
  ('NEW', 'PROFESSIONAL', 'NONE', 52000),
  ('NEW', 'MASTER', 'NONE', 57000),
  ('NEW', 'DOCTOR', 'NONE', 63000),
  ('EXISTING', 'PROFESSIONAL', 'NONE', 62000),
  ('EXISTING', 'PROFESSIONAL', 'LEVEL_1', 64000),
  ('EXISTING', 'PROFESSIONAL', 'LEVEL_2', 66000),
  ('EXISTING', 'PROFESSIONAL', 'LEVEL_3', 68000),
  ('EXISTING', 'MASTER', 'NONE', 67000),
  ('EXISTING', 'MASTER', 'LEVEL_1', 69000),
  ('EXISTING', 'MASTER', 'LEVEL_2', 71000),
  ('EXISTING', 'MASTER', 'LEVEL_3', 73000),
  ('EXISTING', 'DOCTOR', 'NONE', 73000),
  ('EXISTING', 'DOCTOR', 'LEVEL_1', 75000),
  ('EXISTING', 'DOCTOR', 'LEVEL_2', 77000),
  ('EXISTING', 'DOCTOR', 'LEVEL_3', 79000),
  ('DIVING_PRINCIPAL', 'NOT_APPLICABLE', 'NONE', 66000),
  ('DIVING_SECONDARY', 'NOT_APPLICABLE', 'NONE', 62000)
) r(category, degree, certification, amount)
WHERE s."isActive";

COMMIT;
