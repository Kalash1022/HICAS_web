import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

import { IS_PUBLIC_KEY, Public } from './public.decorator';
import { ROLES_KEY, Roles } from './roles.decorator';

@Public()
class PublicController {}

@Roles(UserRole.STAFF, UserRole.ADMIN)
class ManagementController {}

describe('authentication metadata decorators', () => {
  const reflector = new Reflector();

  it('marks a handler or controller as public', () => {
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, PublicController)).toBe(true);
  });

  it('records the accepted database roles', () => {
    expect(reflector.get<UserRole[]>(ROLES_KEY, ManagementController)).toEqual([
      UserRole.STAFF,
      UserRole.ADMIN,
    ]);
  });
});
