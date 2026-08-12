import { Injectable } from '@nestjs/common';
import { AuthProvider, Prisma, UserRole, UserStatus } from '@prisma/client';

import { DatabaseService } from '../../database/database.service';

const GOOGLE_IDENTITY_RESOLUTION_ATTEMPTS = 2;

interface ClaimedOauthTransactionRow {
  transactionId: string;
  nonceHash: string;
  pkceVerifierEncrypted: string;
  redirectUri: string;
}

export interface CreateGoogleOauthTransactionInput {
  stateHash: string;
  nonceHash: string;
  pkceVerifierEncrypted: string;
  redirectUri: string;
  expiresAt: Date;
}

export type GoogleOauthTransactionClaimResult =
  | {
      kind: 'claimed';
      transactionId: string;
      nonceHash: string;
      pkceVerifierEncrypted: string;
      redirectUri: string;
    }
  | { kind: 'not-found' }
  | { kind: 'expired' }
  | { kind: 'already-used' };

export interface ResolveGoogleIdentityInput {
  providerAccountId: string;
  providerEmail: string;
  emailNormalized: string;
  fullName: string;
  avatarUrl?: string;
  now: Date;
}

export interface GoogleIdentityUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
}

export type GoogleIdentityResolutionResult =
  | {
      kind: 'resolved';
      created: boolean;
      user: GoogleIdentityUser;
    }
  | { kind: 'account-link-required' };

class GoogleIdentityChangedDuringResolutionError extends Error {
  constructor() {
    super('Google identity changed while its owner was being resolved.');
    this.name = GoogleIdentityChangedDuringResolutionError.name;
  }
}

@Injectable()
export class GoogleAuthRepository {
  constructor(private readonly database: DatabaseService) {}

  async createOauthTransaction(
    input: CreateGoogleOauthTransactionInput,
  ): Promise<{ transactionId: string }> {
    const transaction = await this.database.oauthTransaction.create({
      data: {
        stateHash: input.stateHash,
        nonceHash: input.nonceHash,
        pkceVerifierEncrypted: input.pkceVerifierEncrypted,
        redirectUri: input.redirectUri,
        expiresAt: input.expiresAt,
      },
      select: { id: true },
    });

    return { transactionId: transaction.id };
  }

  async claimOauthTransaction(
    stateHash: string,
    now: Date,
  ): Promise<GoogleOauthTransactionClaimResult> {
    return this.database.$transaction(async (transaction) => {
      const claimed = await transaction.$queryRaw<ClaimedOauthTransactionRow[]>`
        UPDATE oauth_transactions
        SET consumed_at = ${now}
        WHERE state_hash = ${stateHash}
          AND consumed_at IS NULL
          AND expires_at > ${now}
        RETURNING
          id AS "transactionId",
          nonce_hash AS "nonceHash",
          pkce_verifier_encrypted AS "pkceVerifierEncrypted",
          redirect_uri AS "redirectUri"
      `;
      const result = claimed[0];
      if (result) {
        return { kind: 'claimed', ...result };
      }

      const existing = await transaction.oauthTransaction.findUnique({
        where: { stateHash },
        select: {
          consumedAt: true,
          expiresAt: true,
        },
      });
      if (!existing) {
        return { kind: 'not-found' };
      }
      if (existing.consumedAt !== null) {
        return { kind: 'already-used' };
      }
      if (existing.expiresAt <= now) {
        return { kind: 'expired' };
      }

      throw new Error('OAuth transaction claim failed despite remaining eligible.');
    });
  }

  async resolveGoogleIdentity(
    input: ResolveGoogleIdentityInput,
  ): Promise<GoogleIdentityResolutionResult> {
    for (let attempt = 0; attempt < GOOGLE_IDENTITY_RESOLUTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction((transaction) =>
          this.resolveGoogleIdentityInTransaction(transaction, input),
        );
      } catch (error) {
        const canRetry =
          attempt + 1 < GOOGLE_IDENTITY_RESOLUTION_ATTEMPTS &&
          isRetryableGoogleIdentityUniqueRace(error);
        if (!canRetry) {
          throw error;
        }
      }
    }

    throw new Error('Google identity resolution exhausted its retry budget.');
  }

  private async resolveGoogleIdentityInTransaction(
    transaction: Prisma.TransactionClient,
    input: ResolveGoogleIdentityInput,
  ): Promise<GoogleIdentityResolutionResult> {
    const identityCandidate = await transaction.authIdentity.findUnique({
      where: {
        provider_providerAccountId: {
          provider: AuthProvider.GOOGLE,
          providerAccountId: input.providerAccountId,
        },
      },
      select: {
        id: true,
        userId: true,
      },
    });

    if (identityCandidate) {
      return this.resolveExistingGoogleIdentity(transaction, identityCandidate, input);
    }

    const accountWithEmail = await transaction.user.findUnique({
      where: { emailNormalized: input.emailNormalized },
      select: { id: true },
    });
    if (accountWithEmail) {
      const identityAfterEmailLookup = await transaction.authIdentity.findUnique({
        where: {
          provider_providerAccountId: {
            provider: AuthProvider.GOOGLE,
            providerAccountId: input.providerAccountId,
          },
        },
        select: {
          id: true,
          userId: true,
        },
      });
      if (identityAfterEmailLookup) {
        return this.resolveExistingGoogleIdentity(transaction, identityAfterEmailLookup, input);
      }

      return { kind: 'account-link-required' };
    }

    const user = await transaction.user.create({
      data: {
        email: input.providerEmail,
        emailNormalized: input.emailNormalized,
        fullName: input.fullName,
        avatarUrl: input.avatarUrl,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: input.now,
        authIdentities: {
          create: {
            provider: AuthProvider.GOOGLE,
            providerAccountId: input.providerAccountId,
            providerEmail: input.providerEmail,
          },
        },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
      },
    });

    return {
      kind: 'resolved',
      created: true,
      user,
    };
  }

  private async resolveExistingGoogleIdentity(
    transaction: Prisma.TransactionClient,
    candidate: { id: string; userId: string },
    input: ResolveGoogleIdentityInput,
  ): Promise<GoogleIdentityResolutionResult> {
    await this.lockUserById(transaction, candidate.userId);
    const identity = await transaction.authIdentity.findUnique({
      where: {
        provider_providerAccountId: {
          provider: AuthProvider.GOOGLE,
          providerAccountId: input.providerAccountId,
        },
      },
      select: {
        id: true,
        userId: true,
        providerEmail: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            status: true,
            emailVerifiedAt: true,
          },
        },
      },
    });
    if (!identity || identity.userId !== candidate.userId) {
      throw new GoogleIdentityChangedDuringResolutionError();
    }

    if (identity.providerEmail !== input.providerEmail) {
      await transaction.authIdentity.update({
        where: { id: identity.id },
        data: { providerEmail: input.providerEmail },
      });
    }

    return {
      kind: 'resolved',
      created: false,
      user: identity.user,
    };
  }

  private async lockUserById(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
    await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM users
      WHERE id = ${userId}::uuid
      FOR UPDATE
    `;
  }
}

function isRetryableGoogleIdentityUniqueRace(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const target = error.meta?.target;
  const identifiers = (Array.isArray(target) ? target : [target])
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeConstraintIdentifier);

  if (identifiers.length === 1) {
    return new Set([
      'emailnormalized',
      'usersemailnormalizedkey',
      'providerprovideraccountid',
      'authidentitiesprovideraccountkey',
    ]).has(identifiers[0] ?? '');
  }

  const targetFields = new Set(identifiers);
  return (
    targetFields.size === 2 && targetFields.has('provider') && targetFields.has('provideraccountid')
  );
}

function normalizeConstraintIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
