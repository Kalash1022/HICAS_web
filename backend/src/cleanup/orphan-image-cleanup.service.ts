import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ObjectStorageService } from '../uploads/object-storage.service';
import { StorageObjectKeyLockService } from '../uploads/storage-object-key-lock.service';
import { CleanupRepository } from './cleanup.repository';
import type { OrphanImageCleanupResult } from './cleanup.types';

const PRODUCT_IMAGE_PREFIX = 'products/';
// User.avatarUrl can be an external Google URL; do not scan users/ without an owned storage key.
const PRODUCT_IMAGE_KEY =
  /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

@Injectable()
export class OrphanImageCleanupService {
  private continuationToken: string | undefined;
  private readonly batchSize: number;
  private readonly gracePeriodMs: number;

  constructor(
    private readonly repository: CleanupRepository,
    private readonly storage: ObjectStorageService,
    private readonly objectKeyLocks: StorageObjectKeyLockService,
    config: ConfigService,
  ) {
    this.batchSize = config.getOrThrow<number>('CLEANUP_BATCH_SIZE');
    this.gracePeriodMs = config.getOrThrow<number>('ORPHAN_IMAGE_GRACE_PERIOD_SECONDS') * 1_000;
  }

  async cleanup(now: Date): Promise<OrphanImageCleanupResult> {
    const page = await this.storage.list({
      prefix: PRODUCT_IMAGE_PREFIX,
      limit: this.batchSize,
      continuationToken: this.continuationToken,
    });
    const cutoff = now.getTime() - this.gracePeriodMs;
    const candidateKeys = page.objects
      .filter(
        (object) =>
          PRODUCT_IMAGE_KEY.test(object.key) &&
          Number.isFinite(object.lastModified.getTime()) &&
          object.lastModified.getTime() <= cutoff,
      )
      .map((object) => object.key);
    const linkedKeys = await this.repository.findProductImageStorageKeys(candidateKeys);
    const orphanKeys = candidateKeys.filter((key) => !linkedKeys.has(key));

    let deleted = 0;
    for (const key of orphanKeys) {
      const removed = await this.objectKeyLocks.runExclusive(key, async () => {
        // The uploader holds this same key lock from S3 put through DB attachment.
        const stillLinkedKeys = await this.repository.findProductImageStorageKeys([key]);
        if (stillLinkedKeys.has(key)) {
          return false;
        }
        await this.storage.delete(key);
        return true;
      });
      if (removed) {
        deleted += 1;
      }
    }

    this.continuationToken = page.continuationToken;
    return {
      inspected: page.objects.length,
      deleted,
      skipped: page.objects.length - deleted,
    };
  }
}
