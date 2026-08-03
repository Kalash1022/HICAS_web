import { HttpStatus, Injectable } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';

import { ApplicationException } from '../common/exceptions/application.exception';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { RequestContext } from '../auth/auth.types';
import type { ListUsersQueryDto } from './dto/list-users-query.dto';
import {
  AdministrationRepository,
  type AdministrationMutationResult,
} from './administration.repository';
import type { AdminUserDetail, AdminUserSummary } from './administration.types';

@Injectable()
export class AdministrationService {
  constructor(private readonly repository: AdministrationRepository) {}

  listUsers(
    actor: AuthenticatedUser,
    query: ListUsersQueryDto,
  ): Promise<PaginatedResult<AdminUserSummary>> {
    this.assertAdmin(actor);
    return this.repository.listUsers(query);
  }

  async getUser(actor: AuthenticatedUser, userId: string): Promise<AdminUserDetail> {
    this.assertAdmin(actor);
    const user = await this.repository.findUser(userId);
    if (!user) {
      this.throwUserNotFound();
    }
    return user;
  }

  async updateStatus(input: {
    actor: AuthenticatedUser;
    targetUserId: string;
    requestedStatus: UserStatus;
    request: RequestContext;
    requestId: string;
  }): Promise<AdminUserDetail> {
    this.assertAdmin(input.actor);
    const result = await this.repository.updateStatus({
      actorId: input.actor.id,
      targetUserId: input.targetUserId,
      requestedStatus: input.requestedStatus,
      request: input.request,
      requestId: input.requestId,
      now: new Date(),
    });
    return this.unwrapMutation(result);
  }

  async updateRole(input: {
    actor: AuthenticatedUser;
    targetUserId: string;
    requestedRole: UserRole;
    request: RequestContext;
    requestId: string;
  }): Promise<AdminUserDetail> {
    this.assertAdmin(input.actor);
    const result = await this.repository.updateRole({
      actorId: input.actor.id,
      targetUserId: input.targetUserId,
      requestedRole: input.requestedRole,
      request: input.request,
      requestId: input.requestId,
      now: new Date(),
    });
    return this.unwrapMutation(result);
  }

  async resetMfa(input: {
    actor: AuthenticatedUser;
    targetUserId: string;
    request: RequestContext;
    requestId: string;
  }): Promise<AdminUserDetail> {
    this.assertAdmin(input.actor);
    if (input.actor.id === input.targetUserId) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'MFA_RESET_SELF_FORBIDDEN',
        'Administrators cannot reset their own MFA with this endpoint.',
      );
    }
    const result = await this.repository.resetMfa({
      actorId: input.actor.id,
      targetUserId: input.targetUserId,
      request: input.request,
      requestId: input.requestId,
      now: new Date(),
    });
    return this.unwrapMutation(result);
  }

  private unwrapMutation(result: AdministrationMutationResult): AdminUserDetail {
    if (result.kind === 'updated') {
      return result.user;
    }
    if (result.kind === 'not-found') {
      this.throwUserNotFound();
    }
    if (result.kind === 'last-active-admin') {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'LAST_ACTIVE_ADMIN_REQUIRED',
        'At least one active Administrator account must remain.',
      );
    }
    throw new ApplicationException(
      HttpStatus.BAD_REQUEST,
      'MFA_RESET_NOT_AVAILABLE',
      'MFA reset is available only for Staff or Administrator accounts.',
    );
  }

  private assertAdmin(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.ADMIN) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_FORBIDDEN',
        'You do not have permission to manage users.',
      );
    }
  }

  private throwUserNotFound(): never {
    throw new ApplicationException(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'User not found.');
  }
}
