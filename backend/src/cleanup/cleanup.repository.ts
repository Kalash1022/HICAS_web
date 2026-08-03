import { Injectable } from '@nestjs/common';
import { MfaTotpStatus, Prisma } from '@prisma/client';

import { DatabaseService } from '../database/database.service';
import type { DatabaseCleanupResult } from './cleanup.types';

type IdRecord = { id: string };

@Injectable()
export class CleanupRepository {
  constructor(private readonly database: DatabaseService) {}

  async cleanupExpired(now: Date, batchSize: number): Promise<DatabaseCleanupResult> {
    return this.database.$transaction(async (transaction) => {
      const oauthTransactionIds = await transaction.oauthTransaction.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        select: { id: true },
      });
      const verificationTokenIds = await transaction.verificationToken.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        select: { id: true },
      });
      const sessionIds = await transaction.session.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        select: { id: true },
      });
      const mfaChallengeIds = await transaction.mfaChallenge.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        select: { id: true },
      });
      const mfaEnrollmentGrantIds = await transaction.mfaEnrollmentGrant.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        select: { id: true },
      });
      const pendingMfaSetupIds = await transaction.mfaTotpMethod.findMany({
        where: {
          status: MfaTotpStatus.PENDING,
          setupExpiresAt: { not: null, lte: now },
        },
        orderBy: [{ setupExpiresAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        select: { id: true },
      });

      const [
        oauthTransactions,
        verificationTokens,
        sessions,
        mfaChallenges,
        mfaEnrollmentGrants,
        pendingMfaSetups,
      ] = await Promise.all([
        this.deleteExpiredOauthTransactions(transaction, oauthTransactionIds, now),
        this.deleteExpiredVerificationTokens(transaction, verificationTokenIds, now),
        this.deleteExpiredSessions(transaction, sessionIds, now),
        this.deleteExpiredMfaChallenges(transaction, mfaChallengeIds, now),
        this.deleteExpiredMfaEnrollmentGrants(transaction, mfaEnrollmentGrantIds, now),
        this.deleteExpiredPendingMfaSetups(transaction, pendingMfaSetupIds, now),
      ]);

      return {
        oauthTransactions,
        verificationTokens,
        sessions,
        mfaChallenges,
        mfaEnrollmentGrants,
        pendingMfaSetups,
      };
    });
  }

  async findProductImageStorageKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) {
      return new Set();
    }
    const images = await this.database.productImage.findMany({
      where: { storageKey: { in: keys } },
      select: { storageKey: true },
    });
    return new Set(images.map((image) => image.storageKey));
  }

  private async deleteExpiredOauthTransactions(
    transaction: Prisma.TransactionClient,
    rows: IdRecord[],
    now: Date,
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const result = await transaction.oauthTransaction.deleteMany({
      where: { id: { in: rows.map((row) => row.id) }, expiresAt: { lte: now } },
    });
    return result.count;
  }

  private async deleteExpiredVerificationTokens(
    transaction: Prisma.TransactionClient,
    rows: IdRecord[],
    now: Date,
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const result = await transaction.verificationToken.deleteMany({
      where: { id: { in: rows.map((row) => row.id) }, expiresAt: { lte: now } },
    });
    return result.count;
  }

  private async deleteExpiredSessions(
    transaction: Prisma.TransactionClient,
    rows: IdRecord[],
    now: Date,
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const result = await transaction.session.deleteMany({
      where: { id: { in: rows.map((row) => row.id) }, expiresAt: { lte: now } },
    });
    return result.count;
  }

  private async deleteExpiredMfaChallenges(
    transaction: Prisma.TransactionClient,
    rows: IdRecord[],
    now: Date,
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const result = await transaction.mfaChallenge.deleteMany({
      where: { id: { in: rows.map((row) => row.id) }, expiresAt: { lte: now } },
    });
    return result.count;
  }

  private async deleteExpiredMfaEnrollmentGrants(
    transaction: Prisma.TransactionClient,
    rows: IdRecord[],
    now: Date,
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const result = await transaction.mfaEnrollmentGrant.deleteMany({
      where: { id: { in: rows.map((row) => row.id) }, expiresAt: { lte: now } },
    });
    return result.count;
  }

  private async deleteExpiredPendingMfaSetups(
    transaction: Prisma.TransactionClient,
    rows: IdRecord[],
    now: Date,
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const result = await transaction.mfaTotpMethod.deleteMany({
      where: {
        id: { in: rows.map((row) => row.id) },
        status: MfaTotpStatus.PENDING,
        setupExpiresAt: { not: null, lte: now },
      },
    });
    return result.count;
  }
}
