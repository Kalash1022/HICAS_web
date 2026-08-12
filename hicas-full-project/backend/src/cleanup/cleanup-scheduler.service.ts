import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CleanupRepository } from './cleanup.repository';
import { OrphanImageCleanupService } from './orphan-image-cleanup.service';
import type { CleanupRunResult } from './cleanup.types';

@Injectable()
export class CleanupSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CleanupSchedulerService.name);
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly repository: CleanupRepository,
    private readonly orphanImages: OrphanImageCleanupService,
    config: ConfigService,
  ) {
    this.intervalMs = config.getOrThrow<number>('CLEANUP_INTERVAL_SECONDS') * 1_000;
    this.batchSize = config.getOrThrow<number>('CLEANUP_BATCH_SIZE');
  }

  onApplicationBootstrap(): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runOnce(now = new Date()): Promise<CleanupRunResult | null> {
    if (this.running) {
      return null;
    }
    this.running = true;

    try {
      const [database, orphanImages] = await Promise.all([
        this.cleanupDatabase(now),
        this.cleanupOrphanImages(now),
      ]);
      this.logSummary(database, orphanImages);
      return { database, orphanImages };
    } finally {
      this.running = false;
    }
  }

  private async cleanupDatabase(now: Date): Promise<CleanupRunResult['database']> {
    try {
      return await this.repository.cleanupExpired(now, this.batchSize);
    } catch (error) {
      this.logStageFailure('database-expiry', error);
      return null;
    }
  }

  private async cleanupOrphanImages(now: Date): Promise<CleanupRunResult['orphanImages']> {
    try {
      return await this.orphanImages.cleanup(now);
    } catch (error) {
      this.logStageFailure('orphan-images', error);
      return null;
    }
  }

  private logSummary(
    database: CleanupRunResult['database'],
    orphanImages: CleanupRunResult['orphanImages'],
  ): void {
    const databaseDeleted = database
      ? database.oauthTransactions +
        database.verificationTokens +
        database.sessions +
        database.mfaChallenges +
        database.mfaEnrollmentGrants +
        database.pendingMfaSetups
      : 0;
    const orphanDeleted = orphanImages?.deleted ?? 0;
    if (databaseDeleted === 0 && orphanDeleted === 0) {
      return;
    }
    this.logger.log(
      `Cleanup completed: databaseDeleted=${databaseDeleted}, orphanImagesDeleted=${orphanDeleted}.`,
    );
  }

  private logStageFailure(stage: string, error: unknown): void {
    const errorType = error instanceof Error ? error.name : typeof error;
    this.logger.error(`Cleanup stage failed: stage=${stage}, errorType=${errorType}.`);
  }
}
