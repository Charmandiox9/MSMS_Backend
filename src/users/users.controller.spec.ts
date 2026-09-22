import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AssignRoleDto, PreloadUserDto } from './users.controller';

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

describe('PreloadUserDto', () => {
  it('normalizes the email and accepts one or more seeded role identifiers', async () => {
    const dto = plainToInstance(PreloadUserDto, {
      email: '  NEW.USER@UCN.CL ',
      roleIds: ['00000000-0000-0000-0000-000000000001'],
    });

    expect(dto.email).toBe('new.user@ucn.cl');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('requires a valid email and at least one distinct role', async () => {
    const dto = plainToInstance(PreloadUserDto, {
      email: 'not-an-email',
      roleIds: [],
    });

    await expect(validate(dto)).resolves.toHaveLength(2);
  });
});
