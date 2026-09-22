import { Injectable } from '@nestjs/common';
import { JustificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async systemAdmin() {
    const [users, activeUsers, roles, pendingJustifications] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.role.count(),
      this.prisma.justification.count({ where: { status: JustificationStatus.PENDING } }),
    ]);
    return { users, activeUsers, roles, pendingJustifications };
  }

  async academicSecretary() {
    const semester = { isActive: true };
    const [teachers, activeCourses, activeSchedules, pendingJustifications] = await Promise.all([
      this.prisma.teacher.count({ where: { assignments: { some: { semester } } } }),
      this.prisma.course.count({ where: { schedules: { some: { semester } } } }),
      this.prisma.courseSchedule.count({ where: { semester } }),
      this.prisma.justification.count({ where: { status: JustificationStatus.PENDING } }),
    ]);
    return { teachers, activeCourses, activeSchedules, pendingJustifications };
  }

  async academicProcessAnalyst() {
    const semester = { isActive: true };
    const [teachers, activeCourses, activeAssignments, justifications] = await Promise.all([
      this.prisma.teacher.count({ where: { assignments: { some: { semester } } } }),
      this.prisma.course.count({ where: { OR: [{ schedules: { some: { semester } } }, { assignments: { some: { semester } } }] } }),
      this.prisma.teachingAssignment.count({ where: { semester } }),
      this.prisma.justification.count(),
    ]);
    return { teachers, activeCourses, activeAssignments, justifications };
  }

  async teachingSupportCoordinator() {
    const semester = { isActive: true };
    const [unreadInbox, pendingJustifications, activeAssignments, activeSchedules] = await Promise.all([
      this.prisma.justificationInbox.count({ where: { status: 'UNREAD' } }),
      this.prisma.justification.count({ where: { status: JustificationStatus.PENDING } }),
      this.prisma.teachingAssignment.count({ where: { semester } }),
      this.prisma.courseSchedule.count({ where: { semester } }),
    ]);
    return { unreadInbox, pendingJustifications, activeAssignments, activeSchedules };
  }
}
