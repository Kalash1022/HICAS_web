import {
  CreateBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const S3_CLIENT = Symbol('S3_CLIENT');

export interface StoredObject {
  key: string;
  url: string;
}

export interface StoredObjectMetadata {
  key: string;
  lastModified: Date;
}

export interface StoredObjectPage {
  objects: StoredObjectMetadata[];
  continuationToken?: string;
}

export class StorageOperationError extends Error {
  constructor(operation: 'delete' | 'list' | 'upload', cause?: unknown) {
    super(`Object storage ${operation} failed.`);
    this.name = 'StorageOperationError';
    this.cause = cause;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

@Injectable()
export class ObjectStorageService {
  private readonly bucket: string;
  private readonly publicBaseUrl: URL;

  constructor(
    @Inject(S3_CLIENT) private readonly client: S3Client,
    config: ConfigService,
  ) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    const configuredPublicBaseUrl = config.get<string>('S3_PUBLIC_BASE_URL');
    const fallback = new URL(config.getOrThrow<string>('S3_ENDPOINT'));
    if (!fallback.pathname.endsWith('/')) {
      fallback.pathname += '/';
    }
    this.publicBaseUrl = configuredPublicBaseUrl ? new URL(configuredPublicBaseUrl) : fallback;
    if (!this.publicBaseUrl.pathname.endsWith('/')) {
      this.publicBaseUrl.pathname += '/';
    }
  }

  async uploadWebp(key: string, body: Buffer): Promise<StoredObject> {
    try {
      await this.putObject(key, body);
      return { key, url: this.publicUrl(key) };
    } catch (error) {
      if (errorName(error) !== 'NoSuchBucket') {
        throw new StorageOperationError('upload', error);
      }
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        await this.putObject(key, body);
        return { key, url: this.publicUrl(key) };
      } catch (retryError) {
        throw new StorageOperationError('upload', retryError);
      }
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      throw new StorageOperationError('delete', error);
    }
  }

  async list(input: {
    prefix: string;
    limit: number;
    continuationToken?: string;
  }): Promise<StoredObjectPage> {
    try {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: input.prefix,
          MaxKeys: input.limit,
          ...(input.continuationToken === undefined
            ? {}
            : { ContinuationToken: input.continuationToken }),
        }),
      );
      const objects = (page.Contents ?? []).flatMap((object) => {
        if (!object.Key || !object.LastModified) {
          return [];
        }
        return [{ key: object.Key, lastModified: object.LastModified }];
      });

      return {
        objects,
        ...(page.NextContinuationToken === undefined
          ? {}
          : { continuationToken: page.NextContinuationToken }),
      };
    } catch (error) {
      throw new StorageOperationError('list', error);
    }
  }

  private async putObject(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  private publicUrl(key: string): string {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return new URL(
      `${encodeURIComponent(this.bucket)}/${encodedKey}`,
      this.publicBaseUrl,
    ).toString();
  }
}
