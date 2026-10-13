ALTER TABLE "Course" ALTER COLUMN "code" DROP NOT NULL;
-- Remove legacy NRC placeholders without replacing course IDs or relationships.
UPDATE "Course" AS course SET "code" = NULL
WHERE EXISTS (SELECT 1 FROM "CourseSchedule" schedule WHERE schedule."courseId" = course."id" AND schedule."nrc" = course."code")
   OR EXISTS (SELECT 1 FROM "TeachingAssignment" assignment WHERE assignment."courseId" = course."id" AND assignment."nrc" = course."code");
