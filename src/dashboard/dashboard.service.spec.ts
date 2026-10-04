import { JustificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;

  const prisma = {
    user: { count: jest.fn() },
    role: { count: jest.fn() },
    teacher: { count: jest.fn() },
    course: { count: jest.fn() },
    courseSchedule: { count: jest.fn() },
    teachingAssignment: { count: jest.fn() },
    justification: { count: jest.fn() },
    justificationInbox: { count: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DashboardService(prisma as unknown as PrismaService);
  });

  it('resume usuarios, roles y justificaciones pendientes para el administrador', async () => {
    prisma.user.count.mockResolvedValueOnce(12).mockResolvedValueOnce(10);
    prisma.role.count.mockResolvedValue(4);
    prisma.justification.count.mockResolvedValue(3);

    await expect(service.systemAdmin()).resolves.toEqual({
      users: 12,
      activeUsers: 10,
      roles: 4,
      pendingJustifications: 3,
    });
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { isActive: true },
    });
    expect(prisma.justification.count).toHaveBeenCalledWith({
      where: { status: JustificationStatus.PENDING },
    });
  });

  it('cuenta solo datos del semestre activo para secretaría académica', async () => {
    prisma.teacher.count.mockResolvedValue(8);
    prisma.course.count.mockResolvedValue(20);
    prisma.courseSchedule.count.mockResolvedValue(60);
    prisma.justification.count.mockResolvedValue(2);

    await expect(service.academicSecretary()).resolves.toEqual({
      teachers: 8,
      activeCourses: 20,
      activeSchedules: 60,
      pendingJustifications: 2,
    });
    expect(prisma.teacher.count).toHaveBeenCalledWith({
      where: { assignments: { some: { semester: { isActive: true } } } },
    });
    expect(prisma.courseSchedule.count).toHaveBeenCalledWith({
      where: { semester: { isActive: true } },
    });
  });

  it('cuenta todas las justificaciones para el analista de procesos', async () => {
    prisma.teacher.count.mockResolvedValue(8);
    prisma.course.count.mockResolvedValue(21);
    prisma.teachingAssignment.count.mockResolvedValue(30);
    prisma.justification.count.mockResolvedValue(45);

    await expect(service.academicProcessAnalyst()).resolves.toEqual({
      teachers: 8,
      activeCourses: 21,
      activeAssignments: 30,
      justifications: 45,
    });
    expect(prisma.justification.count).toHaveBeenCalledWith();
  });

  it('incluye la bandeja no leída para el coordinador de apoyo docente', async () => {
    prisma.justificationInbox.count.mockResolvedValue(5);
    prisma.justification.count.mockResolvedValue(2);
    prisma.teachingAssignment.count.mockResolvedValue(30);
    prisma.courseSchedule.count.mockResolvedValue(60);

    await expect(service.teachingSupportCoordinator()).resolves.toEqual({
      unreadInbox: 5,
      pendingJustifications: 2,
      activeAssignments: 30,
      activeSchedules: 60,
    });
    expect(prisma.justificationInbox.count).toHaveBeenCalledWith({
      where: { status: 'UNREAD' },
    });
  });
});
