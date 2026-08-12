import { MfaTotpStatus } from '@prisma/client';

import type { DatabaseService } from '../database/database.service';
import { CleanupRepository } from './cleanup.repository';

const now = new Date('2026-08-03T00:00:00.000Z');

function databaseWithExpiredRows() {
  const transaction = {
    oauthTransaction: {
      findMany: jest.fn().mockResolvedValue([{ id: 'oauth-id' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    verificationToken: {
      findMany: jest.fn().mockResolvedValue([{ id: 'verification-id' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    session: {
      findMany: jest.fn().mockResolvedValue([{ id: 'session-id' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    mfaChallenge: {
      findMany: jest.fn().mockResolvedValue([{ id: 'challenge-id' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
    },
    mfaEnrollmentGrant: {
      findMany: jest.fn().mockResolvedValue([{ id: 'grant-id' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
    },
    mfaTotpMethod: {
      findMany: jest.fn().mockResolvedValue([{ id: 'setup-id' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 6 }),
    },
  };
  return {
    transaction,
    database: {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
      productImage: { findMany: jest.fn() },
    } as unknown as DatabaseService,
  };
}

describe(CleanupRepository.name, () => {
  it('deletes only bounded, expired rows and preserves enabled MFA', async () => {
    const { database, transaction } = databaseWithExpiredRows();
    const repository = new CleanupRepository(database);

    await expect(repository.cleanupExpired(now, 25)).resolves.toEqual({
      oauthTransactions: 1,
      verificationTokens: 2,
      sessions: 3,
      mfaChallenges: 4,
      mfaEnrollmentGrants: 5,
      pendingMfaSetups: 6,
    });

    expect(transaction.oauthTransaction.findMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: 25,
      select: { id: true },
    });
    expect(transaction.session.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['session-id'] }, expiresAt: { lte: now } },
    });
    expect(transaction.mfaTotpMethod.findMany).toHaveBeenCalledWith({
      where: {
        status: MfaTotpStatus.PENDING,
        setupExpiresAt: { not: null, lte: now },
      },
      orderBy: [{ setupExpiresAt: 'asc' }, { id: 'asc' }],
      take: 25,
      select: { id: true },
    });
    expect(transaction.mfaTotpMethod.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['setup-id'] },
        status: MfaTotpStatus.PENDING,
        setupExpiresAt: { not: null, lte: now },
      },
    });
  });

  it('does not issue a delete when a bounded selection is empty', async () => {
    const { database, transaction } = databaseWithExpiredRows();
    transaction.oauthTransaction.findMany.mockResolvedValue([]);
    const repository = new CleanupRepository(database);

    await repository.cleanupExpired(now, 25);

    expect(transaction.oauthTransaction.deleteMany.mock.calls).toHaveLength(0);
  });

  it('returns storage keys currently referenced by ProductImage records', async () => {
    const findMany = jest.fn().mockResolvedValue([{ storageKey: 'products/a/a.webp' }]);
    const repository = new CleanupRepository({
      productImage: { findMany },
    } as unknown as DatabaseService);

    await expect(
      repository.findProductImageStorageKeys(['products/a/a.webp', 'products/b/b.webp']),
    ).resolves.toEqual(new Set(['products/a/a.webp']));
    expect(findMany).toHaveBeenCalledWith({
      where: { storageKey: { in: ['products/a/a.webp', 'products/b/b.webp'] } },
      select: { storageKey: true },
    });
  });

  it('returns only storage keys currently owned by User avatar records', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { avatarStorageKey: 'users/a/avatar/a.webp' },
        { avatarStorageKey: null },
      ]);
    const repository = new CleanupRepository({
      user: { findMany },
    } as unknown as DatabaseService);

    await expect(
      repository.findUserAvatarStorageKeys(['users/a/avatar/a.webp', 'users/b/avatar/b.webp']),
    ).resolves.toEqual(new Set(['users/a/avatar/a.webp']));
    expect(findMany).toHaveBeenCalledWith({
      where: { avatarStorageKey: { in: ['users/a/avatar/a.webp', 'users/b/avatar/b.webp'] } },
      select: { avatarStorageKey: true },
    });
  });
});
