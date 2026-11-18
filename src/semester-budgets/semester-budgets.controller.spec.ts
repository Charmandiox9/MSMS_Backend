import 'reflect-metadata';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import {
  SemesterBudgetAlertsController,
  SemesterBudgetSettingsController,
} from './semester-budgets.controller';
import type { SemesterBudgetsService } from './semester-budgets.service';

describe('Semester budget controllers', () => {
  it('limits budget configuration to the academic secretary role (system admin bypass is global)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, SemesterBudgetSettingsController),
    ).toEqual(['ACADEMIC_SECRETARY']);
  });

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
});
