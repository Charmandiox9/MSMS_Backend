ALTER TABLE "AcademicSemester" ADD CONSTRAINT "AcademicSemester_name_key" UNIQUE ("name");
UPDATE "TeachingAssignment" SET "parallel" = '' WHERE "parallel" IS NULL;
ALTER TABLE "TeachingAssignment" ALTER COLUMN "parallel" SET DEFAULT '';
ALTER TABLE "TeachingAssignment" ALTER COLUMN "parallel" SET NOT NULL;
