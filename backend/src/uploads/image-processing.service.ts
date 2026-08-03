import { HttpStatus, Injectable } from '@nestjs/common';
import sharp from 'sharp';

import { ApplicationException } from '../common/exceptions/application.exception';

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGE_COUNT = 10;

export interface OptimizedProductImage {
  buffer: Buffer;
  contentType: 'image/webp';
}

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
  async optimizeProductImage(buffer: Buffer): Promise<OptimizedProductImage> {
    if (buffer.length === 0) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'IMAGE_FILE_REQUIRED',
        'An image file is required.',
      );
    }
    if (buffer.length > MAX_PRODUCT_IMAGE_BYTES) {
      throw new ApplicationException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'IMAGE_FILE_TOO_LARGE',
        'Product images must be at most 5 MB.',
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
      const optimized = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 2_048, height: 2_048, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      return { buffer: optimized, contentType: 'image/webp' };
    } catch {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'IMAGE_INVALID_FORMAT',
        'The uploaded image could not be processed.',
      );
    }
  }
}
