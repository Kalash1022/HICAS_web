import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ObjectStorageService } from '../uploads/object-storage.service';
import { StorageObjectKeyLockService } from '../uploads/storage-object-key-lock.service';
import { CleanupRepository } from './cleanup.repository';
import type { OrphanImageCleanupResult } from './cleanup.types';

const PRODUCT_IMAGE_PREFIX = 'products/';
const USER_AVATAR_PREFIX = 'users/';
const PRODUCT_IMAGE_KEY =
  /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;
const USER_AVATAR_KEY =
  /^users\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/avatar\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

interface ManagedImageScope {
  prefix: string;
  isManagedKey: (key: string) => boolean;
  findLinkedKeys: (keys: string[]) => Promise<Set<string>>;
}

interface ScopeCleanupResult extends OrphanImageCleanupResult {
  continuationToken?: string;
}

@Injectable()
export class OrphanImageCleanupService {
  private productContinuationToken: string | undefined;
  private userAvatarContinuationToken: string | undefined;
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
    const productImages = await this.cleanupScope(
      {
        prefix: PRODUCT_IMAGE_PREFIX,
        isManagedKey: (key) => PRODUCT_IMAGE_KEY.test(key),
        findLinkedKeys: (keys) => this.repository.findProductImageStorageKeys(keys),
      },
      this.productContinuationToken,
      now,
    );
    this.productContinuationToken = productImages.continuationToken;

    const userAvatars = await this.cleanupScope(
      {
        prefix: USER_AVATAR_PREFIX,
        isManagedKey: (key) => USER_AVATAR_KEY.test(key),
        findLinkedKeys: (keys) => this.repository.findUserAvatarStorageKeys(keys),
      },
      this.userAvatarContinuationToken,
      now,
    );
    this.userAvatarContinuationToken = userAvatars.continuationToken;

    return {
      inspected: productImages.inspected + userAvatars.inspected,
      deleted: productImages.deleted + userAvatars.deleted,
      skipped: productImages.skipped + userAvatars.skipped,
    };
  }

  private async cleanupScope(
    scope: ManagedImageScope,
    continuationToken: string | undefined,
    now: Date,
  ): Promise<ScopeCleanupResult> {
    const page = await this.storage.list({
      prefix: scope.prefix,
      limit: this.batchSize,
      continuationToken,
    });
    const cutoff = now.getTime() - this.gracePeriodMs;
    const candidateKeys = page.objects
      .filter(
        (object) =>
          scope.isManagedKey(object.key) &&
          Number.isFinite(object.lastModified.getTime()) &&
          object.lastModified.getTime() <= cutoff,
      )
      .map((object) => object.key);
    const linkedKeys = await scope.findLinkedKeys(candidateKeys);
    const orphanKeys = candidateKeys.filter((key) => !linkedKeys.has(key));

    let deleted = 0;
    for (const key of orphanKeys) {
      const removed = await this.objectKeyLocks.runExclusive(key, async () => {
        // The uploader holds this same key lock from S3 put through DB attachment.
        const stillLinkedKeys = await scope.findLinkedKeys([key]);
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

    return {
      inspected: page.objects.length,
      deleted,
      skipped: page.objects.length - deleted,
      ...(page.continuationToken === undefined
        ? {}
        : { continuationToken: page.continuationToken }),
    };
  }
}
