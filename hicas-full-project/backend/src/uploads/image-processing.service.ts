import { HttpStatus, Injectable } from '@nestjs/common';
import sharp from 'sharp';

import { ApplicationException } from '../common/exceptions/application.exception';

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
// Kept for existing product upload callers.
export const MAX_PRODUCT_IMAGE_BYTES = MAX_IMAGE_UPLOAD_BYTES;
export const MAX_PRODUCT_IMAGE_COUNT = 10;
export const MAX_CONCURRENT_IMAGE_PROCESSES = 2;

export interface OptimizedImage {
  buffer: Buffer;
  contentType: 'image/webp';
}

export type OptimizedProductImage = OptimizedImage;

function hasJpegMagicBytes(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function hasPngMagicBytes(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function hasWebpMagicBytes(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

@Injectable()
export class ImageProcessingService {
  private readonly waitingProcesses: Array<() => void> = [];
  private activeProcesses = 0;

  async optimizeImage(buffer: Buffer): Promise<OptimizedImage> {
    if (buffer.length === 0) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'IMAGE_FILE_REQUIRED',
        'An image file is required.',
      );
    }
    if (buffer.length > MAX_IMAGE_UPLOAD_BYTES) {
      throw new ApplicationException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'IMAGE_FILE_TOO_LARGE',
        'Images must be at most 5 MB.',
      );
    }
    if (!hasJpegMagicBytes(buffer) && !hasPngMagicBytes(buffer) && !hasWebpMagicBytes(buffer)) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'IMAGE_INVALID_FORMAT',
        'Only JPEG, PNG, and WebP images are accepted.',
      );
    }

    try {
      const release = await this.acquireProcessingSlot();
      try {
        const optimized = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
          .rotate()
          .resize({ width: 2_048, height: 2_048, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toBuffer();
        return { buffer: optimized, contentType: 'image/webp' };
      } finally {
        release();
      }
    } catch (error) {
      if (error instanceof ApplicationException) {
        throw error;
      }
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'IMAGE_INVALID_FORMAT',
        'The uploaded image could not be processed.',
      );
    }
  }

  async optimizeProductImage(buffer: Buffer): Promise<OptimizedProductImage> {
    return this.optimizeImage(buffer);
  }

  private async acquireProcessingSlot(): Promise<() => void> {
    if (this.activeProcesses < MAX_CONCURRENT_IMAGE_PROCESSES) {
      this.activeProcesses += 1;
      return () => this.releaseProcessingSlot();
    }

    await new Promise<void>((resolve) => {
      this.waitingProcesses.push(resolve);
    });
    return () => this.releaseProcessingSlot();
  }

  private releaseProcessingSlot(): void {
    const next = this.waitingProcesses.shift();
    if (next) {
      next();
      return;
    }
    this.activeProcesses -= 1;
  }
}
