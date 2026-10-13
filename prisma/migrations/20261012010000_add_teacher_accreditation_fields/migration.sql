-- AlterTable
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "academicDegree" TEXT;
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "professionalTitle" TEXT;
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "institution" TEXT;
