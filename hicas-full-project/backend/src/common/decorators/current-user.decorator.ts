import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest, AuthenticatedUser } from '../types/authenticated-user';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
