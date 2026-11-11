DROP INDEX "CurriculumCourse_curriculumVersionId_courseId_key";
CREATE INDEX "CurriculumCourse_curriculumVersionId_courseId_idx"
  ON "CurriculumCourse"("curriculumVersionId", "courseId");
