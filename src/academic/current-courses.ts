import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** An offering survives changes to its teachers while students are enrolled. */
export async function loadCurrentCourses(tx: Prisma.TransactionClient) {
  const semester = await tx.academicSemester.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  if (!semester) return { semester: null, courses: [] };
  const course = { select: { id: true, name: true, code: true } } as const;
  const [schedules, assignments, enrollments] = await Promise.all([
    tx.courseSchedule.findMany({
      where: { semesterId: semester.id },
      select: { nrc: true, course },
    }),
    tx.teachingAssignment.findMany({
      where: { semesterId: semester.id },
      select: {
        nrc: true,
        course,
        teacher: { select: { id: true, name: true, email: true } },
      },
    }),
    tx.studentEnrollment.findMany({
      where: { semesterId: semester.id },
      distinct: ['nrc', 'courseId'],
      select: { nrc: true, course },
    }),
  ]);
  type Offering = {
    nrc: string;
    courseId: string;
    name: string;
    code: string | null;
    teachers: { id: string; name: string; email: string }[];
  };
  const courses = new Map<string, Offering>();
  for (const item of [...schedules, ...assignments, ...enrollments]) {
    if (!item.nrc) continue;
    const existing = courses.get(item.nrc);
    if (existing && existing.courseId !== item.course.id)
      throw new ConflictException(
        'Un NRC está asociado a varias asignaturas. Revisa la carga académica',
      );
    if (!existing)
      courses.set(item.nrc, {
        nrc: item.nrc,
        courseId: item.course.id,
        name: item.course.name,
        code: item.course.code,
        teachers: [],
      });
  }
  for (const assignment of assignments) {
    const offering = courses.get(assignment.nrc);
    if (
      offering &&
      !offering.teachers.some(({ id }) => id === assignment.teacher.id)
    )
      offering.teachers.push(assignment.teacher);
  }
  return {
    semester,
    courses: [...courses.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
