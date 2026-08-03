import type { ConfigService } from '@nestjs/config';

import { ObjectStorageService } from '../uploads/object-storage.service';
import { StorageObjectKeyLockService } from '../uploads/storage-object-key-lock.service';
import { CleanupRepository } from './cleanup.repository';
import { OrphanImageCleanupService } from './orphan-image-cleanup.service';

const now = new Date('2026-08-03T12:00:00.000Z');
const productId = '11111111-1111-4111-8111-111111111111';
const referencedImageId = '22222222-2222-4222-8222-222222222222';
const orphanImageId = '33333333-3333-4333-8333-333333333333';
const referencedKey = `products/${productId}/${referencedImageId}.webp`;
const orphanKey = `products/${productId}/${orphanImageId}.webp`;

describe(OrphanImageCleanupService.name, () => {
  let repository: jest.Mocked<CleanupRepository>;
  let storage: jest.Mocked<ObjectStorageService>;
  let objectKeyLocks: jest.Mocked<StorageObjectKeyLockService>;
  let config: ConfigService;
  let service: OrphanImageCleanupService;

  beforeEach(() => {
    repository = {
      findProductImageStorageKeys: jest.fn(),
    } as unknown as jest.Mocked<CleanupRepository>;
    storage = {
      list: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ObjectStorageService>;
    objectKeyLocks = {
      runExclusive: jest.fn((_key: string, operation: () => Promise<unknown>) => operation()),
    } as unknown as jest.Mocked<StorageObjectKeyLockService>;
    config = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, number> = {
          CLEANUP_BATCH_SIZE: 10,
          ORPHAN_IMAGE_GRACE_PERIOD_SECONDS: 3_600,
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    service = new OrphanImageCleanupService(repository, storage, objectKeyLocks, config);
  });

  it('deletes only old, unreferenced, generated product objects after a second DB check', async () => {
    storage.list.mockResolvedValue({
      objects: [
        { key: referencedKey, lastModified: new Date(now.getTime() - 7_200_000) },
        { key: orphanKey, lastModified: new Date(now.getTime() - 7_200_000) },
        {
          key: `products/${productId}/44444444-4444-4444-8444-444444444444.webp`,
          lastModified: now,
        },
        {
          key: 'products/not-a-managed-key.txt',
          lastModified: new Date(now.getTime() - 7_200_000),
        },
      ],
      continuationToken: 'next-page',
    });
    repository.findProductImageStorageKeys.mockResolvedValueOnce(new Set([referencedKey]));
    repository.findProductImageStorageKeys.mockResolvedValueOnce(new Set());
    storage.delete.mockResolvedValue(undefined);

    await expect(service.cleanup(now)).resolves.toEqual({ inspected: 4, deleted: 1, skipped: 3 });

    expect(repository.findProductImageStorageKeys.mock.calls).toEqual([
      [[referencedKey, orphanKey]],
      [[orphanKey]],
    ]);
    expect(objectKeyLocks.runExclusive.mock.calls[0]?.[0]).toBe(orphanKey);
    expect(storage.delete.mock.calls).toEqual([[orphanKey]]);
  });

  it('leaves the page position unchanged when object deletion fails so it can retry', async () => {
    storage.list.mockResolvedValue({
      objects: [{ key: orphanKey, lastModified: new Date(now.getTime() - 7_200_000) }],
      continuationToken: 'next-page',
    });
    repository.findProductImageStorageKeys.mockResolvedValue(new Set());
    storage.delete
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(undefined);

    await expect(service.cleanup(now)).rejects.toThrow('storage unavailable');
    await expect(service.cleanup(now)).resolves.toEqual({ inspected: 1, deleted: 1, skipped: 0 });

    expect(storage.list.mock.calls[0]?.[0]).toEqual({
      prefix: 'products/',
      limit: 10,
      continuationToken: undefined,
    });
    expect(storage.list.mock.calls[1]?.[0]).toEqual({
      prefix: 'products/',
      limit: 10,
      continuationToken: undefined,
    });
  });

  it('waits for an in-flight upload key lock before rechecking the database link', async () => {
    const realLocks = new StorageObjectKeyLockService();
    const guardedService = new OrphanImageCleanupService(repository, storage, realLocks, config);
    storage.list.mockResolvedValue({
      objects: [{ key: orphanKey, lastModified: new Date(now.getTime() - 7_200_000) }],
    });
    repository.findProductImageStorageKeys.mockResolvedValueOnce(new Set());
    repository.findProductImageStorageKeys.mockResolvedValueOnce(new Set([orphanKey]));
    let finishUpload: (() => void) | undefined;
    const upload = realLocks.runExclusive(
      orphanKey,
      () =>
        new Promise<void>((resolve) => {
          finishUpload = resolve;
        }),
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    const cleanup = guardedService.cleanup(now);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(repository.findProductImageStorageKeys.mock.calls).toHaveLength(1);
    expect(storage.delete.mock.calls).toHaveLength(0);

    finishUpload?.();
    await upload;
    await expect(cleanup).resolves.toEqual({ inspected: 1, deleted: 0, skipped: 1 });
    expect(storage.delete.mock.calls).toHaveLength(0);
  });

  it('moves through paginated object pages and restarts after the final page', async () => {
    storage.list
      .mockResolvedValueOnce({ objects: [], continuationToken: 'next-page' })
      .mockResolvedValueOnce({ objects: [] })
      .mockResolvedValueOnce({ objects: [] });
    repository.findProductImageStorageKeys.mockResolvedValue(new Set());

    await service.cleanup(now);
    await service.cleanup(now);
    await service.cleanup(now);

    expect(storage.list.mock.calls.map(([input]) => input?.continuationToken)).toEqual([
      undefined,
      'next-page',
      undefined,
    ]);
  });
});
