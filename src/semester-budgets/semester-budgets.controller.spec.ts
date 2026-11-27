import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  SemesterBudgetAlertsController,
  SemesterBudgetSettingsController,
} from './semester-budgets.controller';
import type { SemesterBudgetsService } from './semester-budgets.service';

describe('Semester budget controllers', () => {
  it.each(['get', 'update'] as const)(
    'authorizes budget %s for administration, secretariat, and analysis',
    (method) => {
      const guard = new RolesGuard(new Reflector());
      const context = (role: string) =>
        ({
          getType: () => 'http',
          getClass: () => SemesterBudgetSettingsController,
          getHandler: () => SemesterBudgetSettingsController.prototype[method],
          switchToHttp: () => ({
            getRequest: () => ({ user: { roles: [role] } }),
          }),
        }) as unknown as ExecutionContext;

      for (const role of [
        'SYSTEM_ADMIN',
        'ACADEMIC_SECRETARY',
        'ACADEMIC_PROCESS_ANALYST',
      ]) {
        expect(guard.canActivate(context(role))).toBe(true);
      }
      expect(() =>
        guard.canActivate(context('TEACHING_SUPPORT_COORDINATOR')),
      ).toThrow(ForbiddenException);
    },
  );

  it('passes the authenticated user roles to dashboard alert filtering', async () => {
    const alerts = jest.fn().mockResolvedValue([]);
    const controller = new SemesterBudgetAlertsController({
      alerts,
    } as unknown as SemesterBudgetsService);
    const user = {
      id: 'user-id',
      email: 'secret@example.org',
      roles: ['ACADEMIC_SECRETARY'],
    };
    await controller.alerts(user);
    expect(alerts).toHaveBeenCalledWith(user.roles);
    expect(
      Reflect.getMetadata(ROLES_KEY, SemesterBudgetAlertsController),
    ).toBeUndefined();
  });

  it('allows teacher-page roles to read the PH summary for the requested semester', async () => {
    const hourlyTeachersSummary = jest
      .fn()
      .mockResolvedValue({ allocatedClp: 8000000 });
    const controller = new SemesterBudgetSettingsController({
      hourlyTeachersSummary,
    } as unknown as SemesterBudgetsService);
    expect(Reflect.getMetadata(ROLES_KEY, controller.hourlyTeachers)).toEqual([
      'ACADEMIC_SECRETARY',
      'ACADEMIC_PROCESS_ANALYST',
    ]);
    await expect(controller.hourlyTeachers('semester-id')).resolves.toEqual({
      allocatedClp: 8000000,
    });
    expect(hourlyTeachersSummary).toHaveBeenCalledWith('semester-id');
  });

  it('protects the read-only budget overview for analysts', async () => {
    const overview = jest.fn().mockResolvedValue({ state: 'no-semester' });
    const controller = new SemesterBudgetAlertsController({
      overview,
    } as unknown as SemesterBudgetsService);
    expect(Reflect.getMetadata(ROLES_KEY, controller.overview)).toEqual([
      'ACADEMIC_PROCESS_ANALYST',
    ]);
    await expect(controller.overview()).resolves.toEqual({
      state: 'no-semester',
    });
    expect(overview).toHaveBeenCalledTimes(1);
  });
});
