import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { TitulationsController } from './titulations.controller';

describe('Titulation attachment authorization', () => {
  const reflector = new Reflector();
  const managementRoles = [
    'ACADEMIC_SECRETARY',
    'TEACHING_SUPPORT_COORDINATOR',
  ];

  it('limits attachment routes to secretary and teaching support', () => {
    for (const method of [
      'listAttachments',
      'uploadAttachment',
      'downloadAttachment',
    ] as const) {
      const handler = TitulationsController.prototype[method];

      expect(reflector.get<string[]>(ROLES_KEY, handler)).toEqual(
        managementRoles,
      );
    }
  });
});
