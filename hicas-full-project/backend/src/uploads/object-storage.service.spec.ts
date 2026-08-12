import { ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';

import { ObjectStorageService } from './object-storage.service';

describe(ObjectStorageService.name, () => {
  it('stores WebP with a deterministic public URL', async () => {
    const commands: unknown[] = [];
    const send = jest.fn((command: unknown): Promise<Record<string, never>> => {
      commands.push(command);
      return Promise.resolve({});
    });
    const client = { send } as unknown as S3Client;
    const config = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          S3_BUCKET: 'hicas',
          S3_ENDPOINT: 'http://localhost:9000',
        };
        return values[key];
      }),
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const storage = new ObjectStorageService(client, config);

    await expect(
      storage.uploadWebp('products/product-id/image.webp', Buffer.from('webp')),
    ).resolves.toEqual({
      key: 'products/product-id/image.webp',
      url: 'http://localhost:9000/hicas/products/product-id/image.webp',
    });

    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
  });

  it('lists one bounded object-storage page with a continuation token', async () => {
    const commands: unknown[] = [];
    const lastModified = new Date('2026-08-03T00:00:00.000Z');
    const send = jest.fn((command: unknown): Promise<Record<string, unknown>> => {
      commands.push(command);
      return Promise.resolve({
        Contents: [{ Key: 'products/product-id/image.webp', LastModified: lastModified }, {}],
        NextContinuationToken: 'next-page',
      });
    });
    const config = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          S3_BUCKET: 'hicas',
          S3_ENDPOINT: 'http://localhost:9000',
        };
        return values[key];
      }),
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const storage = new ObjectStorageService({ send } as unknown as S3Client, config);

    await expect(
      storage.list({ prefix: 'products/', limit: 50, continuationToken: 'previous-page' }),
    ).resolves.toEqual({
      objects: [{ key: 'products/product-id/image.webp', lastModified }],
      continuationToken: 'next-page',
    });

    expect(commands[0]).toBeInstanceOf(ListObjectsV2Command);
    expect((commands[0] as ListObjectsV2Command).input).toMatchObject({
      Bucket: 'hicas',
      Prefix: 'products/',
      MaxKeys: 50,
      ContinuationToken: 'previous-page',
    });
  });
});
