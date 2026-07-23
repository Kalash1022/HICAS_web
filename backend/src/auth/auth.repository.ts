import { Injectable } from '@nestjs/common';
import {
  AuthProvider,
  MfaTotpStatus,
  PrimaryAuthMethod,
  Prisma,
  SecurityEventType,
  UserRole,
  UserStatus,
  VerificationTokenType,
} from '@prisma/client';

import { DatabaseService } from '../database/database.service';
import {
  EMAIL_VERIFICATION_TTL_MS,
  MFA_ENROLLMENT_TTL_SECONDS,
  PASSWORD_RESET_TTL_MS,
} from './auth.constants';
import type { PasswordLoginRecord, RequestContext } from './auth.types';
import {
  addDays,
  addMilliseconds,
  addSeconds,
  createOpaqueToken,
  hashOpaqueToken,
} from './utilities/auth-crypto';

interface LockedUserIdRow {
  id: string;
}

interface LockedVerificationToken {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
  user: {
    status: UserStatus;
    emailVerifiedAt: Date | null;
  };
}

interface EligibleMailRecipient {
  email: string;
  fullName: string;
  token: string;
}

export interface PasswordResetEligibility {
  emailNormalized: string;
}

export interface CreatedPendingUser extends EligibleMailRecipient {
  id: string;
}

export type PrimaryAuthenticationProof =
  | {
      method: typeof PrimaryAuthMethod.PASSWORD;
      passwordHash: string;
    }
  | {
      method: typeof PrimaryAuthMethod.GOOGLE;
      providerAccountId: string;
    };

export type PrimaryAuthenticationDatabaseResult =
  | {
      kind: 'session';
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
  | {
      kind: 'mfa-enrollment';
      enrollmentToken: string;
      expiresIn: number;
    }
  | {
      kind: 'mfa-challenge';
      mfaToken: string;
      expiresIn: number;
    }
  | {
      kind: 'status-rejected';
      status: UserStatus;
    }
  | { kind: 'credentials-changed' };

export type RefreshDatabaseResult =
  | {
      kind: 'rotated';
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
  | { kind: 'invalid' }
  | { kind: 'reuse' }
  | { kind: 'status-rejected'; status: UserStatus };

function clientErrorCode(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly database: DatabaseService) {}

  async createPendingUser(input: {
    email: string;
    emailNormalized: string;
    fullName: string;
    passwordHash: string;
    verificationTokenHash: string;
    verificationToken: string;
    now: Date;
  }): Promise<CreatedPendingUser | null> {
    try {
      const user = await this.database.$transaction(async (transaction) => {
        return transaction.user.create({
          data: {
            email: input.email,
            emailNormalized: input.emailNormalized,
            fullName: input.fullName,
            role: UserRole.CUSTOMER,
            status: UserStatus.PENDING,
            passwordCredential: {
              create: {
                passwordHash: input.passwordHash,
                passwordChangedAt: input.now,
              },
            },
            verificationTokens: {
              create: {
                type: VerificationTokenType.EMAIL_VERIFICATION,
                tokenHash: input.verificationTokenHash,
                expiresAt: addMilliseconds(input.now, EMAIL_VERIFICATION_TTL_MS),
              },
            },
          },
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        });
      });

      return { ...user, token: input.verificationToken };
    } catch (error) {
      if (clientErrorCode(error) === 'P2002') {
        const duplicateEmail = await this.database.user.findUnique({
          where: { emailNormalized: input.emailNormalized },
          select: { id: true },
        });
        if (duplicateEmail) {
          return null;
        }
      }
      throw error;
    }
  }

  async consumeEmailVerification(tokenHash: string, now: Date): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const record = await this.findAndLockVerificationToken(
        transaction,
        tokenHash,
        VerificationTokenType.EMAIL_VERIFICATION,
      );

      if (
        !record ||
        record.usedAt !== null ||
        record.expiresAt <= now ||
        record.user.status !== UserStatus.PENDING ||
        record.user.emailVerifiedAt !== null
      ) {
        return false;
      }

      await transaction.verificationToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      });
      await transaction.user.update({
        where: { id: record.userId },
        data: {
          status: UserStatus.ACTIVE,
          emailVerifiedAt: now,
        },
      });

      return true;
    });
  }

  async rotateEmailVerificationToken(input: {
    emailNormalized: string;
    token: string;
    tokenHash: string;
    now: Date;
  }): Promise<EligibleMailRecipient | null> {
    return this.database.$transaction(async (transaction) => {
      const user = await this.lockUserByNormalizedEmail(transaction, input.emailNormalized);

      if (!user || user.status !== UserStatus.PENDING || user.emailVerifiedAt !== null) {
        return null;
      }

      await transaction.verificationToken.updateMany({
        where: {
          userId: user.id,
          type: VerificationTokenType.EMAIL_VERIFICATION,
          usedAt: null,
        },
        data: { usedAt: input.now },
      });
      await transaction.verificationToken.create({
        data: {
          userId: user.id,
          type: VerificationTokenType.EMAIL_VERIFICATION,
          tokenHash: input.tokenHash,
          expiresAt: addMilliseconds(input.now, EMAIL_VERIFICATION_TTL_MS),
        },
      });

      return {
        email: user.email,
        fullName: user.fullName,
        token: input.token,
      };
    });
  }

  async createPasswordResetToken(input: {
    emailNormalized: string;
    token: string;
    tokenHash: string;
    now: Date;
  }): Promise<EligibleMailRecipient | null> {
    return this.database.$transaction(async (transaction) => {
      const user = await this.lockUserByNormalizedEmail(transaction, input.emailNormalized);

      if (!user || user.status !== UserStatus.ACTIVE || user.emailVerifiedAt === null) {
        return null;
      }

      const credential = await transaction.passwordCredential.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!credential) {
        return null;
      }

      await transaction.verificationToken.updateMany({
        where: {
          userId: user.id,
          type: VerificationTokenType.PASSWORD_RESET,
          usedAt: null,
        },
        data: { usedAt: input.now },
      });
      await transaction.verificationToken.create({
        data: {
          userId: user.id,
          type: VerificationTokenType.PASSWORD_RESET,
          tokenHash: input.tokenHash,
          expiresAt: addMilliseconds(input.now, PASSWORD_RESET_TTL_MS),
        },
      });

      return {
        email: user.email,
        fullName: user.fullName,
        token: input.token,
      };
    });
  }

  async findPasswordResetEligibility(
    tokenHash: string,
    now: Date,
  ): Promise<PasswordResetEligibility | null> {
    const token = await this.database.verificationToken.findUnique({
      where: { tokenHash },
      select: {
        type: true,
        expiresAt: true,
        usedAt: true,
        user: {
          select: {
            emailNormalized: true,
            status: true,
            emailVerifiedAt: true,
            passwordCredential: {
              select: { id: true },
            },
          },
        },
      },
    });

    if (
      !token ||
      token.type !== VerificationTokenType.PASSWORD_RESET ||
      token.usedAt !== null ||
      token.expiresAt <= now ||
      token.user.status !== UserStatus.ACTIVE ||
      token.user.emailVerifiedAt === null ||
      token.user.passwordCredential === null
    ) {
      return null;
    }

    return { emailNormalized: token.user.emailNormalized };
  }

  async resetPassword(input: {
    tokenHash: string;
    passwordHash: string;
    now: Date;
  }): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const record = await this.findAndLockVerificationToken(
        transaction,
        input.tokenHash,
        VerificationTokenType.PASSWORD_RESET,
      );

      if (
        !record ||
        record.usedAt !== null ||
        record.expiresAt <= input.now ||
        record.user.status !== UserStatus.ACTIVE ||
        record.user.emailVerifiedAt === null
      ) {
        return false;
      }

      const updatedCredential = await transaction.passwordCredential.updateMany({
        where: { userId: record.userId },
        data: {
          passwordHash: input.passwordHash,
          passwordChangedAt: input.now,
        },
      });
      if (updatedCredential.count !== 1) {
        return false;
      }

      await Promise.all([
        transaction.verificationToken.updateMany({
          where: {
            userId: record.userId,
            type: VerificationTokenType.PASSWORD_RESET,
            usedAt: null,
          },
          data: { usedAt: input.now },
        }),
        transaction.session.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: input.now },
        }),
        transaction.mfaEnrollmentGrant.updateMany({
          where: {
            userId: record.userId,
            consumedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: input.now },
        }),
        transaction.mfaChallenge.deleteMany({
          where: { userId: record.userId, consumedAt: null },
        }),
      ]);
      await transaction.securityEvent.create({
        data: {
          userId: record.userId,
          type: SecurityEventType.PASSWORD_RESET,
          metadata: {},
        },
      });

      return true;
    });
  }

  async findPasswordLogin(emailNormalized: string): Promise<PasswordLoginRecord | null> {
    const user = await this.database.user.findUnique({
      where: { emailNormalized },
      select: {
        id: true,
        email: true,
        emailNormalized: true,
        fullName: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        passwordCredential: {
          select: { passwordHash: true },
        },
      },
    });

    if (!user) {
      return null;
    }

    return {
      ...user,
      passwordHash: user.passwordCredential?.passwordHash ?? null,
    };
  }

  async recordLoginFailure(userId: string | null, context: RequestContext): Promise<void> {
    await this.database.securityEvent.create({
      data: {
        userId,
        type: SecurityEventType.LOGIN_FAILED,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { method: 'PASSWORD' },
      },
    });
  }

  async beginPrimaryAuthentication(input: {
    userId: string;
    proof: PrimaryAuthenticationProof;
    context: RequestContext;
    refreshTtlDays: number;
    mfaChallengeTtlSeconds: number;
    now: Date;
  }): Promise<PrimaryAuthenticationDatabaseResult> {
    const refreshToken = createOpaqueToken();
    const enrollmentToken = createOpaqueToken();
    const mfaToken = createOpaqueToken();

    return this.database.$transaction(async (transaction) => {
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
          passwordCredential: {
            select: { passwordHash: true },
          },
          authIdentities: {
            where: { provider: AuthProvider.GOOGLE },
            select: { providerAccountId: true },
          },
          mfaTotpMethod: {
            select: { status: true },
          },
        },
      });
      if (!user) {
        return { kind: 'status-rejected', status: UserStatus.BLOCKED };
      }
      if (user.status !== UserStatus.ACTIVE || user.emailVerifiedAt === null) {
        await transaction.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: input.now },
        });
        return {
          kind: 'status-rejected',
          status: user.status === UserStatus.BLOCKED ? UserStatus.BLOCKED : UserStatus.PENDING,
        };
      }
      const proof = input.proof;
      let credentialIsCurrent: boolean;
      if (proof.method === PrimaryAuthMethod.PASSWORD) {
        credentialIsCurrent = user.passwordCredential?.passwordHash === proof.passwordHash;
      } else {
        const providerAccountId = proof.providerAccountId;
        credentialIsCurrent = user.authIdentities.some(
          (identity) => identity.providerAccountId === providerAccountId,
        );
      }
      if (!credentialIsCurrent) {
        return { kind: 'credentials-changed' };
      }

      await transaction.user.update({
        where: { id: user.id },
        data: { lastLoginAt: input.now },
      });

      if (user.role === UserRole.CUSTOMER) {
        const expiresAt = addDays(input.now, input.refreshTtlDays);
        const session = await transaction.session.create({
          data: {
            userId: user.id,
            refreshTokenHash: hashOpaqueToken(refreshToken),
            expiresAt,
            ipAddress: input.context.ipAddress,
            userAgent: input.context.userAgent,
            lastUsedAt: input.now,
          },
          select: { id: true },
        });

        return {
          kind: 'session',
          sessionId: session.id,
          refreshToken,
          refreshTokenExpiresAt: expiresAt,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
          },
        };
      }

      if (user.mfaTotpMethod?.status !== MfaTotpStatus.ENABLED) {
        await transaction.mfaEnrollmentGrant.updateMany({
          where: {
            userId: user.id,
            consumedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: input.now },
        });
        await transaction.mfaEnrollmentGrant.create({
          data: {
            userId: user.id,
            tokenHash: hashOpaqueToken(enrollmentToken),
            primaryMethod: input.proof.method,
            expiresAt: addSeconds(input.now, MFA_ENROLLMENT_TTL_SECONDS),
          },
        });

        return {
          kind: 'mfa-enrollment',
          enrollmentToken,
          expiresIn: MFA_ENROLLMENT_TTL_SECONDS,
        };
      }

      await transaction.mfaChallenge.deleteMany({
        where: {
          userId: user.id,
          consumedAt: null,
        },
      });
      await transaction.mfaChallenge.create({
        data: {
          userId: user.id,
          tokenHash: hashOpaqueToken(mfaToken),
          primaryMethod: input.proof.method,
          maxAttempts: 5,
          expiresAt: addSeconds(input.now, input.mfaChallengeTtlSeconds),
          ipAddress: input.context.ipAddress,
        },
      });

      return {
        kind: 'mfa-challenge',
        mfaToken,
        expiresIn: input.mfaChallengeTtlSeconds,
      };
    });
  }

  async findRefreshTokenFamilyId(refreshTokenHash: string): Promise<string | null> {
    const session = await this.database.session.findUnique({
      where: { refreshTokenHash },
      select: { tokenFamilyId: true },
    });

    return session?.tokenFamilyId ?? null;
  }

  async rotateRefreshToken(input: {
    refreshTokenHash: string;
    newRefreshToken: string;
    refreshTtlDays: number;
    context: RequestContext;
    now: Date;
  }): Promise<RefreshDatabaseResult> {
    const candidate = await this.database.session.findUnique({
      where: { refreshTokenHash: input.refreshTokenHash },
      select: { id: true, userId: true },
    });
    if (!candidate) {
      return { kind: 'invalid' };
    }

    return this.database.$transaction(async (transaction) => {
      await this.lockUserById(transaction, candidate.userId);
      await this.lockSessionById(transaction, candidate.id);

      const session = await transaction.session.findUnique({
        where: { id: candidate.id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
              role: true,
              status: true,
              emailVerifiedAt: true,
              mfaTotpMethod: {
                select: { status: true },
              },
            },
          },
        },
      });
      if (!session) {
        return { kind: 'invalid' };
      }

      if (session.revokedAt !== null) {
        if (session.replacedBySessionId !== null) {
          await transaction.session.updateMany({
            where: {
              tokenFamilyId: session.tokenFamilyId,
              revokedAt: null,
            },
            data: { revokedAt: input.now },
          });
          return { kind: 'reuse' };
        }
        return { kind: 'invalid' };
      }

      if (session.user.status !== UserStatus.ACTIVE || session.user.emailVerifiedAt === null) {
        await transaction.session.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: input.now },
        });
        return {
          kind: 'status-rejected',
          status:
            session.user.status === UserStatus.BLOCKED ? UserStatus.BLOCKED : UserStatus.PENDING,
        };
      }
      if (
        session.user.role !== UserRole.CUSTOMER &&
        session.user.mfaTotpMethod?.status !== MfaTotpStatus.ENABLED
      ) {
        await transaction.session.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: input.now },
        });
        return { kind: 'invalid' };
      }
      if (session.expiresAt <= input.now) {
        await transaction.session.update({
          where: { id: session.id },
          data: { revokedAt: input.now },
        });
        return { kind: 'invalid' };
      }

      const expiresAt = addDays(input.now, input.refreshTtlDays);
      const replacement = await transaction.session.create({
        data: {
          userId: session.userId,
          refreshTokenHash: hashOpaqueToken(input.newRefreshToken),
          tokenFamilyId: session.tokenFamilyId,
          expiresAt,
          ipAddress: input.context.ipAddress,
          userAgent: input.context.userAgent,
          lastUsedAt: input.now,
        },
        select: { id: true },
      });
      await transaction.session.update({
        where: { id: session.id },
        data: {
          revokedAt: input.now,
          replacedBySessionId: replacement.id,
          lastUsedAt: input.now,
        },
      });

      return {
        kind: 'rotated',
        sessionId: replacement.id,
        refreshToken: input.newRefreshToken,
        refreshTokenExpiresAt: expiresAt,
        user: {
          id: session.user.id,
          email: session.user.email,
          fullName: session.user.fullName,
          role: session.user.role,
        },
      };
    });
  }

  async revokeRefreshToken(refreshTokenHash: string, now: Date): Promise<void> {
    const candidate = await this.database.session.findUnique({
      where: { refreshTokenHash },
      select: { id: true, userId: true },
    });
    if (!candidate) {
      return;
    }

    await this.database.$transaction(async (transaction) => {
      await this.lockUserById(transaction, candidate.userId);
      await this.lockSessionById(transaction, candidate.id);
      const session = await transaction.session.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          tokenFamilyId: true,
          revokedAt: true,
          replacedBySessionId: true,
        },
      });
      if (!session) {
        return;
      }

      if (session.replacedBySessionId !== null) {
        await transaction.session.updateMany({
          where: { tokenFamilyId: session.tokenFamilyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return;
      }

      if (session.revokedAt === null) {
        await transaction.session.update({
          where: { id: session.id },
          data: { revokedAt: now },
        });
      }
    });
  }

  private async lockUserByNormalizedEmail(
    transaction: Prisma.TransactionClient,
    emailNormalized: string,
  ): Promise<{
    id: string;
    email: string;
    fullName: string;
    status: UserStatus;
    emailVerifiedAt: Date | null;
  } | null> {
    const rows = await transaction.$queryRaw<
      Array<{
        id: string;
        email: string;
        fullName: string;
        status: UserStatus;
        emailVerifiedAt: Date | null;
      }>
    >`
      SELECT
        id,
        email,
        full_name AS "fullName",
        status,
        email_verified_at AS "emailVerifiedAt"
      FROM users
      WHERE email_normalized = ${emailNormalized}
      FOR UPDATE
    `;

    return rows[0] ?? null;
  }

  private async findAndLockVerificationToken(
    transaction: Prisma.TransactionClient,
    tokenHash: string,
    type: VerificationTokenType,
  ): Promise<LockedVerificationToken | null> {
    const candidate = await transaction.verificationToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        type: true,
      },
    });
    if (!candidate || candidate.type !== type) {
      return null;
    }

    await this.lockUserById(transaction, candidate.userId);
    await this.lockVerificationTokenById(transaction, candidate.id);

    const token = await transaction.verificationToken.findUnique({
      where: { id: candidate.id },
      select: {
        id: true,
        userId: true,
        type: true,
        expiresAt: true,
        usedAt: true,
        user: {
          select: {
            status: true,
            emailVerifiedAt: true,
          },
        },
      },
    });
    if (!token || token.userId !== candidate.userId || token.type !== type) {
      return null;
    }

    return token;
  }

  private async lockUserById(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
    await transaction.$queryRaw<LockedUserIdRow[]>`
      SELECT id
      FROM users
      WHERE id = ${userId}::uuid
      FOR UPDATE
    `;
  }

  private async lockVerificationTokenById(
    transaction: Prisma.TransactionClient,
    tokenId: string,
  ): Promise<void> {
    await transaction.$queryRaw<LockedUserIdRow[]>`
      SELECT id
      FROM verification_tokens
      WHERE id = ${tokenId}::uuid
      FOR UPDATE
    `;
  }

  private async lockSessionById(
    transaction: Prisma.TransactionClient,
    sessionId: string,
  ): Promise<void> {
    await transaction.$queryRaw<LockedUserIdRow[]>`
      SELECT id
      FROM sessions
      WHERE id = ${sessionId}::uuid
      FOR UPDATE
    `;
  }
}
