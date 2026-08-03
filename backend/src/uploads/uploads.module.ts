import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';

import { ImageProcessingService } from './image-processing.service';
import { ObjectStorageService, S3_CLIENT } from './object-storage.service';
import { StorageObjectKeyLockService } from './storage-object-key-lock.service';

@Module({
  imports: [ConfigModule],
  providers: [
    ImageProcessingService,
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): S3Client =>
        new S3Client({
          endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
          region: config.getOrThrow<string>('S3_REGION'),
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
            secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
          },
        }),
    },
    ObjectStorageService,
    StorageObjectKeyLockService,
  ],
  exports: [ImageProcessingService, ObjectStorageService, StorageObjectKeyLockService],
})
export class UploadsModule {}
