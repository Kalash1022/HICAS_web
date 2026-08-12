import { Injectable } from '@nestjs/common';
import { MfaTotpStatus, Prisma, SecurityEventType, UserRole, UserStatus } from '@prisma/client';

import { DatabaseService } from '../../database/database.service';
import type { RequestContext } from '../auth.types';
import { addDays, createOpaqueToken, hashOpaqueToken } from '../utilities/auth-crypto';

interface LockedRow {
  id: string;
}

class EnrollmentCompletionConflict extends Error {}
class ChallengeCompletionConflict extends Error {}

export interface MfaEnrollmentContext {
  userId: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  grantExpiresAt: Date;
  grantConsumedAt: Date | null;
  grantRevokedAt: Date | null;
  method: {
    status: MfaTotpStatus;
    secretEncrypted: string;
    setupExpiresAt: Date | null;
  } | null;
}

export interface MfaChallengeContext {
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
  method: {
    status: MfaTotpStatus;
    secretEncrypted: string;
  } | null;
}

type EligibilityFailure =
  { kind: 'invalid' } | { kind: 'status-rejected'; status: UserStatus } | { kind: 'role-rejected' };

export type SavePendingSetupResult =
  | {
      kind: 'saved';
      email: string;
      setupExpiresAt: Date;
    }
  | EligibilityFailure
  | { kind: 'already-enabled' };

export interface CreatedMfaSession {
  sessionId: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
  };
}

export type CompleteEnrollmentResult =
  ({ kind: 'completed' } & CreatedMfaSession) | EligibilityFailure | { kind: 'setup-required' };

export type CompleteChallengeResult =
  | ({ kind: 'completed' } & CreatedMfaSession)
  | EligibilityFailure
  | { kind: 'invalid-credential' }
  | { kind: 'attempts-exhausted' };

type ChallengeCredential =
  | {
      kind: 'totp';
      expectedSecretEncrypted: string;
      candidateTimeStep: bigint | null;
    }
  | {
      kind: 'recovery';
      recoveryCodeHash: string | null;
    };

@Injectable()
export class MfaRepository {
  constructor(private readonly database: DatabaseService) {}

  async findEnrollmentContext(tokenHash: string): Promise<MfaEnrollmentContext | null> {
    const grant = await this.database.mfaEnrollmentGrant.findUnique({
      where: { tokenHash },
      select: {
        userId: true,
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
        user: {
          select: {
            email: true,
            role: true,
            status: true,
            emailVerifiedAt: true,
            mfaTotpMethod: {
              select: {
                status: true,
                secretEncrypted: true,
                setupExpiresAt: true,
              },
            },
          },
        },
      },
    });

    if (!grant) {
      return null;
    }

    return {
      userId: grant.userId,
      email: grant.user.email,
      role: grant.user.role,
      status: grant.user.status,
      emailVerifiedAt: grant.user.emailVerifiedAt,
      grantExpiresAt: grant.expiresAt,
      grantConsumedAt: grant.consumedAt,
      grantRevokedAt: grant.revokedAt,
      method: grant.user.mfaTotpMethod,
    };
  }

  async savePendingSetup(input: {
    userId: string;
    enrollmentTokenHash: string;
    secretEncrypted: string;
    setupExpiresAt: Date;
    now: Date;
  }): Promise<SavePendingSetupResult> {
    return this.database.$transaction(async (transaction) => {
      await this.lockUserById(transaction, input.userId);

      const user = await transaction.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
          mfaTotpMethod: {
            select: { status: true },
          },
        },
      });
      const grant = await transaction.mfaEnrollmentGrant.findUnique({
        where: { tokenHash: input.enrollmentTokenHash },
        select: {
          userId: true,
          expiresAt: true,
          consumedAt: true,
          revokedAt: true,
        },
      });

      const eligibility = this.enrollmentEligibility(user, grant, input.userId, input.now);
      if (eligibility !== null) {
        return eligibility;
      }
      if (user?.mfaTotpMethod?.status === MfaTotpStatus.ENABLED) {
        return { kind: 'already-enabled' };
      }

      const setupExpiresAt =
        input.setupExpiresAt < grant!.expiresAt ? input.setupExpiresAt : grant!.expiresAt;
      if (setupExpiresAt <= input.now) {
        return { kind: 'invalid' };
      }

      await transaction.mfaTotpMethod.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          secretEncrypted: input.secretEncrypted,
          status: MfaTotpStatus.PENDING,
          setupExpiresAt,
        },
        update: {
          secretEncrypted: input.secretEncrypted,
          status: MfaTotpStatus.PENDING,
          setupExpiresAt,
          enabledAt: null,
          lastUsedTimeStep: null,
        },
      });

      return {
        kind: 'saved',
        email: user!.email,
        setupExpiresAt,
      };
    });
  }

  async completeEnrollment(input: {
    userId: string;
    enrollmentTokenHash: string;
    expectedSecretEncrypted: string;
    candidateTimeStep: bigint;
    recoveryCodeHashes: string[];
    refreshTtlDays: number;
    context: RequestContext;
    now: Date;
  }): Promise<CompleteEnrollmentResult> {
    const refreshToken = createOpaqueToken();

    try {
      return await this.database.$transaction(async (transaction) => {
        await this.lockUserById(transaction, input.userId);

        const user = await transaction.user.findUnique({
          where: { id: input.userId },
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            status: true,
            emailVerifiedAt: true,
            mfaTotpMethod: {
              select: {
                id: true,
                status: true,
                secretEncrypted: true,
                setupExpiresAt: true,
              },
            },
          },
        });
        const grant = await transaction.mfaEnrollmentGrant.findUnique({
          where: { tokenHash: input.enrollmentTokenHash },
          select: {
            id: true,
            userId: true,
            expiresAt: true,
            consumedAt: true,
            revokedAt: true,
          },
        });

        const eligibility = this.enrollmentEligibility(user, grant, input.userId, input.now);
        if (eligibility !== null) {
          return eligibility;
        }

        const method = user?.mfaTotpMethod;
        if (
          method?.status !== MfaTotpStatus.PENDING ||
          method.setupExpiresAt === null ||
          method.setupExpiresAt <= input.now ||
          method.secretEncrypted !== input.expectedSecretEncrypted ||
          input.recoveryCodeHashes.length !== 10 ||
          new Set(input.recoveryCodeHashes).size !== 10
        ) {
          return { kind: 'setup-required' };
        }

        const enabled = await transaction.mfaTotpMethod.updateMany({
          where: {
            id: method.id,
            userId: input.userId,
            status: MfaTotpStatus.PENDING,
            secretEncrypted: input.expectedSecretEncrypted,
            setupExpiresAt: { gt: input.now },
          },
          data: {
            status: MfaTotpStatus.ENABLED,
            setupExpiresAt: null,
            enabledAt: input.now,
            lastUsedTimeStep: input.candidateTimeStep,
          },
        });
        if (enabled.count !== 1) {
          throw new EnrollmentCompletionConflict();
        }

        const consumed = await transaction.mfaEnrollmentGrant.updateMany({
          where: {
            id: grant!.id,
            userId: input.userId,
            consumedAt: null,
            revokedAt: null,
            expiresAt: { gt: input.now },
          },
          data: { consumedAt: input.now },
        });
        if (consumed.count !== 1) {
          throw new EnrollmentCompletionConflict();
        }

        await transaction.mfaEnrollmentGrant.updateMany({
          where: {
            userId: input.userId,
            id: { not: grant!.id },
            consumedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: input.now },
        });
        await transaction.mfaChallenge.deleteMany({
          where: { userId: input.userId, consumedAt: null },
        });
        await transaction.mfaRecoveryCode.deleteMany({
          where: { userId: input.userId },
        });
        await transaction.mfaRecoveryCode.createMany({
          data: input.recoveryCodeHashes.map((codeHash) => ({
            userId: input.userId,
            codeHash,
          })),
        });
        await transaction.securityEvent.create({
          data: {
            userId: input.userId,
            type: SecurityEventType.MFA_CHANGED,
            ipAddress: input.context.ipAddress,
            userAgent: input.context.userAgent,
            metadata: { action: 'ENABLED' },
          },
        });

        const session = await this.createSession(
          transaction,
          user!,
          refreshToken,
          input.refreshTtlDays,
          input.context,
          input.now,
        );
        return { kind: 'completed', ...session };
      });
    } catch (error) {
      if (error instanceof EnrollmentCompletionConflict) {
        return { kind: 'setup-required' };
      }
      throw error;
    }
  }

  async findChallengeContext(tokenHash: string): Promise<MfaChallengeContext | null> {
    const challenge = await this.database.mfaChallenge.findUnique({
      where: { tokenHash },
      select: {
        userId: true,
        expiresAt: true,
        consumedAt: true,
        attemptCount: true,
        maxAttempts: true,
        user: {
          select: {
            mfaTotpMethod: {
              select: {
                status: true,
                secretEncrypted: true,
              },
            },
          },
        },
      },
    });

    if (!challenge) {
      return null;
    }

    return {
      userId: challenge.userId,
      expiresAt: challenge.expiresAt,
      consumedAt: challenge.consumedAt,
      attemptCount: challenge.attemptCount,
      maxAttempts: challenge.maxAttempts,
      method: challenge.user.mfaTotpMethod,
    };
  }

  async completeChallenge(input: {
    userId: string;
    challengeTokenHash: string;
    credential: ChallengeCredential;
    refreshTtlDays: number;
    context: RequestContext;
    now: Date;
  }): Promise<CompleteChallengeResult> {
    const refreshToken = createOpaqueToken();

    try {
      return await this.database.$transaction(async (transaction) => {
        await this.lockUserById(transaction, input.userId);

        const user = await transaction.user.findUnique({
          where: { id: input.userId },
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            status: true,
            emailVerifiedAt: true,
            mfaTotpMethod: {
              select: {
                id: true,
                status: true,
                secretEncrypted: true,
              },
            },
          },
        });
        const challenge = await transaction.mfaChallenge.findUnique({
          where: { tokenHash: input.challengeTokenHash },
          select: {
            id: true,
            userId: true,
            primaryMethod: true,
            attemptCount: true,
            maxAttempts: true,
            expiresAt: true,
            consumedAt: true,
          },
        });

        const eligibility = this.challengeEligibility(user, challenge, input.userId, input.now);
        if (eligibility !== null) {
          return eligibility;
        }
        if (challenge!.attemptCount >= challenge!.maxAttempts) {
          return { kind: 'attempts-exhausted' };
        }

        const method = user!.mfaTotpMethod!;
        let credentialAccepted = false;
        if (input.credential.kind === 'totp') {
          const candidateTimeStep = input.credential.candidateTimeStep;
          if (
            candidateTimeStep !== null &&
            method.secretEncrypted === input.credential.expectedSecretEncrypted
          ) {
            const replayGuard = await transaction.mfaTotpMethod.updateMany({
              where: {
                id: method.id,
                userId: input.userId,
                status: MfaTotpStatus.ENABLED,
                secretEncrypted: input.credential.expectedSecretEncrypted,
                OR: [{ lastUsedTimeStep: null }, { lastUsedTimeStep: { lt: candidateTimeStep } }],
              },
              data: { lastUsedTimeStep: candidateTimeStep },
            });
            credentialAccepted = replayGuard.count === 1;
          }
        } else if (input.credential.recoveryCodeHash !== null) {
          const recoveryCode = await transaction.mfaRecoveryCode.findFirst({
            where: {
              userId: input.userId,
              codeHash: input.credential.recoveryCodeHash,
            },
            select: { id: true },
          });
          if (recoveryCode) {
            const consumedRecoveryCode = await transaction.mfaRecoveryCode.updateMany({
              where: {
                id: recoveryCode.id,
                userId: input.userId,
                usedAt: null,
              },
              data: { usedAt: input.now },
            });
            credentialAccepted = consumedRecoveryCode.count === 1;
          }
        }

        if (!credentialAccepted) {
          return this.recordFailedChallenge(transaction, challenge!, input.userId, input.now);
        }

        const consumedChallenge = await transaction.mfaChallenge.updateMany({
          where: {
            id: challenge!.id,
            userId: input.userId,
            consumedAt: null,
            expiresAt: { gt: input.now },
            attemptCount: { lt: challenge!.maxAttempts },
          },
          data: { consumedAt: input.now },
        });
        if (consumedChallenge.count !== 1) {
          throw new ChallengeCompletionConflict();
        }

        if (input.credential.kind === 'recovery') {
          await transaction.securityEvent.create({
            data: {
              userId: input.userId,
              type: SecurityEventType.MFA_RECOVERY_CODE_USED,
              ipAddress: input.context.ipAddress,
              userAgent: input.context.userAgent,
              metadata: {
                challengeId: challenge!.id,
                primaryMethod: challenge!.primaryMethod,
              },
            },
          });
        }

        const session = await this.createSession(
          transaction,
          user!,
          refreshToken,
          input.refreshTtlDays,
          input.context,
          input.now,
        );
        return { kind: 'completed', ...session };
      });
    } catch (error) {
      if (error instanceof ChallengeCompletionConflict) {
        return { kind: 'invalid' };
      }
      throw error;
    }
  }

  private enrollmentEligibility(
    user: {
      role: UserRole;
      status: UserStatus;
      emailVerifiedAt: Date | null;
    } | null,
    grant: {
      userId: string;
      expiresAt: Date;
      consumedAt: Date | null;
      revokedAt: Date | null;
    } | null,
    expectedUserId: string,
    now: Date,
  ): EligibilityFailure | null {
    if (
      !user ||
      !grant ||
      grant.userId !== expectedUserId ||
      grant.consumedAt !== null ||
      grant.revokedAt !== null ||
      grant.expiresAt <= now
    ) {
      return { kind: 'invalid' };
    }
    const statusFailure = this.statusFailure(user.status, user.emailVerifiedAt);
    if (statusFailure !== null) {
      return statusFailure;
    }
    if (user.role === UserRole.CUSTOMER) {
      return { kind: 'role-rejected' };
    }
    return null;
  }

  private challengeEligibility(
    user: {
      role: UserRole;
      status: UserStatus;
      emailVerifiedAt: Date | null;
      mfaTotpMethod: {
        status: MfaTotpStatus;
      } | null;
    } | null,
    challenge: {
      userId: string;
      expiresAt: Date;
      consumedAt: Date | null;
    } | null,
    expectedUserId: string,
    now: Date,
  ): EligibilityFailure | null {
    if (
      !user ||
      !challenge ||
      challenge.userId !== expectedUserId ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= now ||
      user.mfaTotpMethod?.status !== MfaTotpStatus.ENABLED
    ) {
      return { kind: 'invalid' };
    }
    const statusFailure = this.statusFailure(user.status, user.emailVerifiedAt);
    if (statusFailure !== null) {
      return statusFailure;
    }
    if (user.role === UserRole.CUSTOMER) {
      return { kind: 'role-rejected' };
    }
    return null;
  }

  private statusFailure(
    status: UserStatus,
    emailVerifiedAt: Date | null,
  ): { kind: 'status-rejected'; status: UserStatus } | null {
    if (status !== UserStatus.ACTIVE || emailVerifiedAt === null) {
      return {
        kind: 'status-rejected',
        status: status === UserStatus.BLOCKED ? UserStatus.BLOCKED : UserStatus.PENDING,
      };
    }
    return null;
  }

  private async recordFailedChallenge(
    transaction: Prisma.TransactionClient,
    challenge: {
      id: string;
      attemptCount: number;
      maxAttempts: number;
    },
    userId: string,
    now: Date,
  ): Promise<
    { kind: 'invalid' } | { kind: 'invalid-credential' } | { kind: 'attempts-exhausted' }
  > {
    const nextAttemptCount = challenge.attemptCount + 1;
    const updated = await transaction.mfaChallenge.updateMany({
      where: {
        id: challenge.id,
        userId,
        consumedAt: null,
        expiresAt: { gt: now },
        attemptCount: {
          equals: challenge.attemptCount,
          lt: challenge.maxAttempts,
        },
      },
      data: { attemptCount: { increment: 1 } },
    });
    if (updated.count !== 1) {
      return { kind: 'invalid' };
    }

    return nextAttemptCount >= challenge.maxAttempts
      ? { kind: 'attempts-exhausted' }
      : { kind: 'invalid-credential' };
  }

  private async createSession(
    transaction: Prisma.TransactionClient,
    user: {
      id: string;
      email: string;
      fullName: string;
      role: UserRole;
    },
    refreshToken: string,
    refreshTtlDays: number,
    context: RequestContext,
    now: Date,
  ): Promise<CreatedMfaSession> {
    const refreshTokenExpiresAt = addDays(now, refreshTtlDays);
    const session = await transaction.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashOpaqueToken(refreshToken),
        expiresAt: refreshTokenExpiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        lastUsedAt: now,
      },
      select: { id: true },
    });

    return {
      sessionId: session.id,
      refreshToken,
      refreshTokenExpiresAt,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
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
