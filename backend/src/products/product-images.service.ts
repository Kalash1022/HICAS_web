import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UserRole } from '@prisma/client';

import type { RequestContext } from '../auth/auth.types';
import { ApplicationException } from '../common/exceptions/application.exception';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import {
  ImageProcessingService,
  MAX_PRODUCT_IMAGE_COUNT,
} from '../uploads/image-processing.service';
import { ObjectStorageService, StorageOperationError } from '../uploads/object-storage.service';
import { StorageObjectKeyLockService } from '../uploads/storage-object-key-lock.service';
import { UploadProductImageDto } from './dto/upload-product-image.dto';
import { ProductsRepository } from './products.repository';
import type { ProductImageSummary } from './products.types';

@Injectable()
export class ProductImagesService {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly imageProcessing: ImageProcessingService,
    private readonly storage: ObjectStorageService,
    private readonly objectKeyLocks: StorageObjectKeyLockService,
  ) {}

  async upload(input: {
    actor: AuthenticatedUser;
    productId: string;
    dto: UploadProductImageDto;
    file: Express.Multer.File | undefined;
    request: RequestContext;
    requestId: string;
  }): Promise<ProductImageSummary> {
    this.assertCatalogManager(input.actor);
    if (!input.file) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'IMAGE_FILE_REQUIRED',
        'An image file is required.',
      );
    }

    const product = await this.repository.find(input.productId);
    if (!product) {
      this.throwProductNotFound();
    }
    if (product.images.length >= MAX_PRODUCT_IMAGE_COUNT) {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'PRODUCT_IMAGE_LIMIT_REACHED',
        'A product can have at most ten images.',
      );
    }

    const optimized = await this.imageProcessing.optimizeProductImage(input.file.buffer);
    const storageKey = `products/${input.productId}/${randomUUID()}.webp`;
    return this.objectKeyLocks.runExclusive(storageKey, async () => {
      let uploadedStorageKey: string | null = null;
      try {
        const stored = await this.storage.uploadWebp(storageKey, optimized.buffer);
        uploadedStorageKey = stored.key;
        const result = await this.repository.attachImage({
          actorId: input.actor.id,
          productId: input.productId,
          url: stored.url,
          storageKey: stored.key,
          altText: input.dto.altText,
          sortOrder: input.dto.sortOrder,
          isPrimary: input.dto.isPrimary,
          request: input.request,
          requestId: input.requestId,
        });
        if (result.kind === 'attached') {
          return result.image;
        }
        if (result.kind === 'product-not-found') {
          this.throwProductNotFound();
        }
        if (result.kind === 'max-images') {
          throw new ApplicationException(
            HttpStatus.CONFLICT,
            'PRODUCT_IMAGE_LIMIT_REACHED',
            'A product can have at most ten images.',
          );
        }
        throw new ApplicationException(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'PRODUCT_IMAGE_UPLOAD_FAILED',
          'Product image could not be linked.',
        );
      } catch (error) {
        if (uploadedStorageKey) {
          await this.deleteObjectBestEffort(uploadedStorageKey);
        }
        if (error instanceof StorageOperationError) {
          throw new ApplicationException(
            HttpStatus.SERVICE_UNAVAILABLE,
            'OBJECT_STORAGE_UNAVAILABLE',
            'Product image storage is temporarily unavailable.',
          );
        }
        throw error;
      }
    });
  }

  async delete(input: {
    actor: AuthenticatedUser;
    productId: string;
    imageId: string;
    request: RequestContext;
    requestId: string;
  }): Promise<{ deleted: true }> {
    this.assertCatalogManager(input.actor);
    const result = await this.repository.deleteImage({
      actorId: input.actor.id,
      productId: input.productId,
      imageId: input.imageId,
      request: input.request,
      requestId: input.requestId,
    });
    if (result.kind === 'product-not-found') {
      this.throwProductNotFound();
    }
    if (result.kind === 'image-not-found') {
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        'PRODUCT_IMAGE_NOT_FOUND',
        'Product image not found.',
      );
    }
    if (result.kind !== 'deleted') {
      throw new ApplicationException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'PRODUCT_IMAGE_DELETE_FAILED',
        'Product image could not be deleted.',
      );
    }
    await this.deleteObjectBestEffort(result.storageKey);
    return { deleted: true };
  }

  private async deleteObjectBestEffort(storageKey: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch {
      // The cleanup scheduler removes orphan objects when storage deletion is unavailable.
    }
  }

  private assertCatalogManager(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.STAFF && actor.role !== UserRole.ADMIN) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_FORBIDDEN',
        'You do not have permission to manage the catalog.',
      );
    }
  }

  private throwProductNotFound(): never {
    throw new ApplicationException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }
}
