import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { CleanupRepository } from './cleanup.repository';
import { CleanupSchedulerService } from './cleanup-scheduler.service';
import { OrphanImageCleanupService } from './orphan-image-cleanup.service';
import type { DatabaseCleanupResult } from './cleanup.types';

const now = new Date('2026-08-03T00:00:00.000Z');
const databaseResult: DatabaseCleanupResult = {
  oauthTransactions: 1,
  verificationTokens: 0,
  sessions: 0,
  mfaChallenges: 0,
  mfaEnrollmentGrants: 0,
  pendingMfaSetups: 0,
};

describe(CleanupSchedulerService.name, () => {
  let repository: jest.Mocked<CleanupRepository>;
  let orphanImages: jest.Mocked<OrphanImageCleanupService>;
  let service: CleanupSchedulerService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    repository = { cleanupExpired: jest.fn() } as unknown as jest.Mocked<CleanupRepository>;
    orphanImages = { cleanup: jest.fn() } as unknown as jest.Mocked<OrphanImageCleanupService>;
    const config = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, number> = {
          CLEANUP_INTERVAL_SECONDS: 3_600,
          CLEANUP_BATCH_SIZE: 100,
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    service = new CleanupSchedulerService(repository, orphanImages, config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs database expiry and orphan reconciliation with the same captured time', async () => {
    repository.cleanupExpired.mockResolvedValue(databaseResult);
    orphanImages.cleanup.mockResolvedValue({ inspected: 4, deleted: 2, skipped: 2 });

    await expect(service.runOnce(now)).resolves.toEqual({
      database: databaseResult,
      orphanImages: { inspected: 4, deleted: 2, skipped: 2 },
    });
    expect(repository.cleanupExpired.mock.calls).toEqual([[now, 100]]);
    expect(orphanImages.cleanup.mock.calls).toEqual([[now]]);
  });

  it('skips an overlapping run while the current batch is unresolved', async () => {
    let resolveDatabase: (value: DatabaseCleanupResult) => void;
    repository.cleanupExpired.mockImplementation(
      () =>
        new Promise<DatabaseCleanupResult>((resolve) => {
          resolveDatabase = resolve;
        }),
    );
    orphanImages.cleanup.mockResolvedValue({ inspected: 0, deleted: 0, skipped: 0 });

    const firstRun = service.runOnce(now);
    await expect(service.runOnce(now)).resolves.toBeNull();
    resolveDatabase!(databaseResult);
    await expect(firstRun).resolves.toMatchObject({ database: databaseResult });
  });

  it('logs a failed stage internally and lets the other stage complete', async () => {
    repository.cleanupExpired.mockRejectedValue(new Error('database unavailable'));
    orphanImages.cleanup.mockResolvedValue({ inspected: 1, deleted: 0, skipped: 1 });

    await expect(service.runOnce(now)).resolves.toEqual({
      database: null,
      orphanImages: { inspected: 1, deleted: 0, skipped: 1 },
    });
    expect(orphanImages.cleanup.mock.calls).toEqual([[now]]);
  });
});
