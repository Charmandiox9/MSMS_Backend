import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController', () => {
  it('delega cada panel en su método del servicio', async () => {
    const service = {
      systemAdmin: jest.fn().mockResolvedValue({ users: 1 }),
      academicSecretary: jest.fn().mockResolvedValue({ teachers: 2 }),
      academicProcessAnalyst: jest
        .fn()
        .mockResolvedValue({ justifications: 3 }),
      teachingSupportCoordinator: jest
        .fn()
        .mockResolvedValue({ unreadInbox: 4 }),
    };
    const controller = new DashboardController(
      service as unknown as DashboardService,
    );

    await expect(controller.systemAdmin()).resolves.toEqual({ users: 1 });
    await expect(controller.academicSecretary()).resolves.toEqual({
      teachers: 2,
    });
    await expect(controller.academicProcessAnalyst()).resolves.toEqual({
      justifications: 3,
    });
    await expect(controller.teachingSupportCoordinator()).resolves.toEqual({
      unreadInbox: 4,
    });
  });
});
