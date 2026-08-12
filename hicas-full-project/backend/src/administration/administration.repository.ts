import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  MfaTotpStatus,
  Prisma,
  SecurityEventType,
  UserRole,
  UserStatus,
} from '@prisma/client';

import { DatabaseService } from '../database/database.service';
import type { RequestContext } from '../auth/auth.types';
import type { AdminUserDetail, AdminUserSummary, MfaStatus } from './administration.types';

interface LockedRow {
  id: string;
}

interface MutationContext {
  actorId: string;
  targetUserId: string;
  requestId: string;
  request: RequestContext;
  now: Date;
}

type ManagedUserRecord = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  birthDate: Date | null;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  mfaTotpMethod: { status: MfaTotpStatus } | null;
  authIdentities: { provider: string }[];
};

export type AdministrationMutationResult =
  | { kind: 'not-found' }
  | { kind: 'last-active-admin' }
  | { kind: 'mfa-not-available' }
  | { kind: 'updated'; user: AdminUserDetail; changed: boolean };

@Injectable()
export class AdministrationRepository {
  constructor(private readonly database: DatabaseService) {}

  async listUsers(input: {
    page: number;
    limit: number;
    search?: string;
    role?: UserRole;
    status?: UserStatus;
  }): Promise<{
    data: AdminUserSummary[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const search = input.search?.trim();
    const where: Prisma.UserWhereInput = {
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { fullName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [users, total] = await this.database.$transaction([
      this.database.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        select: this.summarySelect(),
      }),
      this.database.user.count({ where }),
    ]);

    return {
      data: users.map((user) => this.toSummary(user)),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
      },
    };
  }

  async findUser(userId: string): Promise<AdminUserDetail | null> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: this.detailSelect(),
    });
    return user ? this.toDetail(user) : null;
  }

  async updateStatus(
    input: MutationContext & { requestedStatus: UserStatus },
  ): Promise<AdministrationMutationResult> {
    return this.database.$transaction(async (transaction) => {
      const activeAdminIds = await this.lockActiveAdmins(transaction);
      await this.lockUserById(transaction, input.targetUserId);
      const user = await transaction.user.findUnique({
        where: { id: input.targetUserId },
        select: this.detailSelect(),
      });
      if (!user) {
        return { kind: 'not-found' };
      }

      const effectiveStatus =
        input.requestedStatus === UserStatus.ACTIVE && user.emailVerifiedAt === null
          ? UserStatus.PENDING
          : input.requestedStatus;
      if (
        effectiveStatus === UserStatus.BLOCKED &&
        user.role === UserRole.ADMIN &&
        user.status === UserStatus.ACTIVE &&
        activeAdminIds.length <= 1
      ) {
        return { kind: 'last-active-admin' };
      }
      if (effectiveStatus === user.status) {
        return { kind: 'updated', user: this.toDetail(user), changed: false };
      }

      const before = this.auditSnapshot(user);
      const updated = await transaction.user.update({
        where: { id: user.id },
        data: { status: effectiveStatus },
        select: this.detailSelect(),
      });
      await transaction.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: input.now },
      });
      if (effectiveStatus === UserStatus.BLOCKED) {
        await transaction.mfaEnrollmentGrant.updateMany({
          where: { userId: user.id, consumedAt: null, revokedAt: null },
          data: { revokedAt: input.now },
        });
        await transaction.mfaChallenge.deleteMany({
          where: { userId: user.id, consumedAt: null },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          action:
            effectiveStatus === UserStatus.BLOCKED
              ? AuditAction.USER_BLOCKED
              : AuditAction.USER_UNBLOCKED,
          entityType: 'USER',
          entityId: user.id,
          beforeData: before,
          afterData: this.auditSnapshot(updated),
          ipAddress: input.request.ipAddress,
          requestId: input.requestId,
        },
      });

      return { kind: 'updated', user: this.toDetail(updated), changed: true };
    });
  }

  async updateRole(
    input: MutationContext & { requestedRole: UserRole },
  ): Promise<AdministrationMutationResult> {
    return this.database.$transaction(async (transaction) => {
      const activeAdminIds = await this.lockActiveAdmins(transaction);
      await this.lockUserById(transaction, input.targetUserId);
      const user = await transaction.user.findUnique({
        where: { id: input.targetUserId },
        select: this.detailSelect(),
      });
      if (!user) {
        return { kind: 'not-found' };
      }
      if (
        user.role === UserRole.ADMIN &&
        user.status === UserStatus.ACTIVE &&
        input.requestedRole !== UserRole.ADMIN &&
        activeAdminIds.length <= 1
      ) {
        return { kind: 'last-active-admin' };
      }
      if (user.role === input.requestedRole) {
        return { kind: 'updated', user: this.toDetail(user), changed: false };
      }

      const before = this.auditSnapshot(user);
      const removedMfa = input.requestedRole === UserRole.CUSTOMER;
      const updated = await transaction.user.update({
        where: { id: user.id },
        data: { role: input.requestedRole },
        select: this.detailSelect(),
      });
      await transaction.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: input.now },
      });
      await transaction.mfaEnrollmentGrant.updateMany({
        where: { userId: user.id, consumedAt: null, revokedAt: null },
        data: { revokedAt: input.now },
      });
      await transaction.mfaChallenge.deleteMany({
        where: { userId: user.id, consumedAt: null },
      });
      if (removedMfa) {
        await transaction.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
        await transaction.mfaTotpMethod.deleteMany({ where: { userId: user.id } });
        await transaction.securityEvent.create({
          data: {
            userId: user.id,
            type: SecurityEventType.MFA_CHANGED,
            ipAddress: input.request.ipAddress,
            userAgent: input.request.userAgent,
            metadata: { action: 'REMOVED_FOR_CUSTOMER_ROLE', actorId: input.actorId },
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          action: AuditAction.USER_ROLE_CHANGED,
          entityType: 'USER',
          entityId: user.id,
          beforeData: before,
          afterData: this.auditSnapshot({
            ...updated,
            mfaTotpMethod: removedMfa ? null : updated.mfaTotpMethod,
          }),
          ipAddress: input.request.ipAddress,
          requestId: input.requestId,
        },
      });

      return {
        kind: 'updated',
        user: this.toDetail({
          ...updated,
          mfaTotpMethod: removedMfa ? null : updated.mfaTotpMethod,
        }),
        changed: true,
      };
    });
  }

  async resetMfa(input: MutationContext): Promise<AdministrationMutationResult> {
    return this.database.$transaction(async (transaction) => {
      await this.lockUserById(transaction, input.targetUserId);
      const user = await transaction.user.findUnique({
        where: { id: input.targetUserId },
        select: this.detailSelect(),
      });
      if (!user) {
        return { kind: 'not-found' };
      }
      if (user.role === UserRole.CUSTOMER) {
        return { kind: 'mfa-not-available' };
      }

      const before = this.auditSnapshot(user);
      await transaction.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: input.now },
      });
      await transaction.mfaEnrollmentGrant.updateMany({
        where: { userId: user.id, consumedAt: null, revokedAt: null },
        data: { revokedAt: input.now },
      });
      await transaction.mfaChallenge.deleteMany({
        where: { userId: user.id, consumedAt: null },
      });
      await transaction.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await transaction.mfaTotpMethod.deleteMany({ where: { userId: user.id } });
      await transaction.securityEvent.create({
        data: {
          userId: user.id,
          type: SecurityEventType.MFA_RESET_BY_ADMIN,
          ipAddress: input.request.ipAddress,
          userAgent: input.request.userAgent,
          metadata: { actorId: input.actorId },
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          action: AuditAction.USER_MFA_RESET,
          entityType: 'USER',
          entityId: user.id,
          beforeData: before,
          afterData: this.auditSnapshot({ ...user, mfaTotpMethod: null }),
          ipAddress: input.request.ipAddress,
          requestId: input.requestId,
        },
      });

      return {
        kind: 'updated',
        user: this.toDetail({ ...user, mfaTotpMethod: null }),
        changed: true,
      };
    });
  }

  private summarySelect() {
    return {
      id: true,
      email: true,
      fullName: true,
      avatarUrl: true,
      phone: true,
      birthDate: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      mfaTotpMethod: { select: { status: true } },
    } satisfies Prisma.UserSelect;
  }

  private detailSelect() {
    return {
      ...this.summarySelect(),
      updatedAt: true,
      authIdentities: { select: { provider: true } },
    } satisfies Prisma.UserSelect;
  }

  private toSummary(user: {
    id: string;
    email: string;
    fullName: string;
    avatarUrl: string | null;
    phone: string | null;
    birthDate: Date | null;
    role: UserRole;
    status: UserStatus;
    emailVerifiedAt: Date | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    mfaTotpMethod: { status: MfaTotpStatus } | null;
  }): AdminUserSummary {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      phone: user.phone,
      birthDate: user.birthDate,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      mfaStatus: this.mfaStatus(user.mfaTotpMethod),
    };
  }

  private toDetail(user: ManagedUserRecord): AdminUserDetail {
    return {
      ...this.toSummary(user),
      updatedAt: user.updatedAt,
      authProviders: user.authIdentities.map((identity) => identity.provider),
    };
  }

  private auditSnapshot(user: ManagedUserRecord): Prisma.InputJsonValue {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      mfaStatus: this.mfaStatus(user.mfaTotpMethod),
    };
  }

  private mfaStatus(method: { status: MfaTotpStatus } | null): MfaStatus {
    return method?.status ?? 'NONE';
  }

  private async lockActiveAdmins(transaction: Prisma.TransactionClient): Promise<string[]> {
    const rows = await transaction.$queryRaw<LockedRow[]>`
      SELECT id
      FROM users
      WHERE role = ${UserRole.ADMIN}::user_role
        AND status = ${UserStatus.ACTIVE}::user_status
      ORDER BY id
      FOR UPDATE
    `;
    return rows.map((row) => row.id);
  }

  private async lockUserById(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
    await transaction.$queryRaw<LockedRow[]>`
      SELECT id
      FROM users
      WHERE id = ${userId}::uuid
      FOR UPDATE
    `;
  }
}
