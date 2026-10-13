import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { academicScheduleBlocks } from './schedule-blocks';

export type AcademicDataset =
  | 'teachers'
  | 'courses'
  | 'assignments'
  | 'assistants'
  | 'assistantships'
  | 'semesters';
export type ReportRow = Record<string, string | number | null>;
const time = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

@Injectable()
export class AcademicReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async data(dataset: AcademicDataset, semesterId?: string, search?: string) {
    let rows: ReportRow[];
    let columns: string[];
    const assignmentFilter = semesterId ? { semesterId } : {};
    switch (dataset) {
      case 'teachers':
        columns = ['name', 'email', 'status', 'courses'];
        rows = (
          await this.prisma.teacher.findMany({
            where: semesterId
              ? { assignments: { some: assignmentFilter } }
              : {},
            include: {
              assignments: {
                where: assignmentFilter,
                include: { course: true, semester: true },
              },
            },
            orderBy: { name: 'asc' },
          })
        ).map((item) => ({
          name: item.name,
          email: item.email,
          status: item.isActive ? 'ACTIVE' : 'INACTIVE',
          courses: item.assignments
            .map((a) => `${a.course.name} (${a.nrc}, ${a.semester.name})`)
            .join('; '),
        }));
        break;
      case 'courses':
        columns = ['code', 'name', 'courses', 'schedules'];
        rows = (
          await this.prisma.course.findMany({
            where: semesterId
              ? {
                  OR: [
                    { assignments: { some: assignmentFilter } },
                    { schedules: { some: assignmentFilter } },
                  ],
                }
              : {},
            include: {
              assignments: {
                where: assignmentFilter,
                include: { semester: true },
              },
              schedules: {
                where: assignmentFilter,
                include: { semester: true },
              },
            },
            orderBy: { name: 'asc' },
          })
        ).map((item) => ({
          code: item.code,
          name: item.name,
          courses: item.assignments
            .map((a) => `${a.nrc} (${a.semester.name})`)
            .join('; '),
          schedules: item.schedules
            .map(
              (slot) =>
                `${slot.nrc}: ${slot.day} ${slot.block}${slot.location ? ` · ${slot.location}` : ''} (${slot.semester.name})`,
            )
            .join('; '),
        }));
        break;
      case 'assignments':
        columns = ['semester', 'course', 'courseNrc', 'teacher', 'email'];
        rows = (
          await this.prisma.teachingAssignment.findMany({
            where: assignmentFilter,
            include: { course: true, teacher: true, semester: true },
            orderBy: { semester: { startsOn: 'desc' } },
          })
        ).map((a) => ({
          semester: a.semester.name,
          course: a.course.name,
          courseNrc: a.nrc,
          teacher: a.teacher.name,
          email: a.teacher.email,
        }));
        break;
      case 'assistants':
        columns = ['name', 'email', 'status', 'courses'];
        rows = (
          await this.prisma.teachingAssistant.findMany({
            where: semesterId
              ? {
                  approvals: {
                    some: {
                      assistantships: {
                        some: { teachingAssignment: assignmentFilter },
                      },
                    },
                  },
                }
              : {},
            include: { approvals: { include: { course: true } } },
            orderBy: { name: 'asc' },
          })
        ).map((item) => ({
          name: item.name,
          email: item.email,
          status: item.isActive ? 'ACTIVE' : 'INACTIVE',
          courses: item.approvals.map((a) => a.course.name).join('; '),
        }));
        break;
      case 'assistantships':
        columns = [
          'semester',
          'assistantshipNrc',
          'course',
          'courseNrc',
          'teacher',
          'name',
          'email',
          'startsOn',
          'endsOn',
          'weeklyHours',
          'schedules',
        ];
        rows = (
          await this.prisma.assistantship.findMany({
            where: { teachingAssignment: assignmentFilter },
            include: {
              teachingAssignment: {
                include: { semester: true, course: true, teacher: true },
              },
              approval: { include: { assistant: true } },
              schedules: true,
            },
            orderBy: { startsOn: 'desc' },
          })
        ).map((item) => ({
          semester: item.teachingAssignment.semester.name,
          assistantshipNrc: item.nrc,
          course: item.teachingAssignment.course.name,
          courseNrc: item.teachingAssignment.nrc,
          teacher: item.teachingAssignment.teacher.name,
          name: item.approval.assistant.name,
          email: item.approval.assistant.email,
          startsOn: item.startsOn.toISOString().slice(0, 10),
          endsOn: item.endsOn?.toISOString().slice(0, 10) ?? null,
          weeklyHours: item.weeklyHours?.toNumber() ?? null,
          schedules: item.schedules
            .map(
              (schedule) =>
                `${schedule.weekday} ${academicScheduleBlocks.find((block) => block.startsAtMinute === schedule.startsAtMinute && block.endsAtMinute === schedule.endsAtMinute)?.code ?? ''} ${time(schedule.startsAtMinute)}–${time(schedule.endsAtMinute)}${schedule.location ? ` (${schedule.location})` : ''}`,
            )
            .join('; '),
        }));
        break;
      case 'semesters':
        columns = ['name', 'startsOn', 'endsOn', 'status'];
        rows = (
          await this.prisma.academicSemester.findMany({
            where: semesterId ? { id: semesterId } : {},
            orderBy: { startsOn: 'desc' },
          })
        ).map((item) => ({
          name: item.name,
          startsOn: item.startsOn.toISOString().slice(0, 10),
          endsOn: item.endsOn.toISOString().slice(0, 10),
          status: item.isActive ? 'ACTIVE' : 'INACTIVE',
        }));
        break;
    }
    const needle = search?.trim().toLocaleLowerCase();
    return {
      columns,
      rows: needle
        ? rows.filter((row) =>
            Object.values(row).some((value) =>
              String(value ?? '')
                .toLocaleLowerCase()
                .includes(needle),
            ),
          )
        : rows,
    };
  }
}
