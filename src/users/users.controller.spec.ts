import { validate } from 'class-validator';
import { AssignRoleDto } from './users.controller';

describe('AssignRoleDto', () => {
  it('accepts a seeded role identifier with UUID structure', async () => {
    const dto = new AssignRoleDto();
    dto.roleId = '00000000-0000-0000-0000-000000000001';

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects role identifiers that are not UUID-shaped', async () => {
    const dto = new AssignRoleDto();
    dto.roleId = 'system-admin';

    await expect(validate(dto)).resolves.toHaveLength(1);
  });
});
