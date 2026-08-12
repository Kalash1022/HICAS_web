import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { RequestContext } from '../auth/auth.types';
import { AuthRateLimiterService } from '../auth/services/auth-rate-limiter.service';
import { ApplicationException } from '../common/exceptions/application.exception';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ImageProcessingService, type OptimizedImage } from '../uploads/image-processing.service';
import { ObjectStorageService, StorageOperationError } from '../uploads/object-storage.service';
import { StorageObjectKeyLockService } from '../uploads/storage-object-key-lock.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersRepository } from './users.repository';
import { toProfileView, type ProfileView } from './users.types';

@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly imageProcessing: ImageProcessingService,
    private readonly storage: ObjectStorageService,
    private readonly objectKeyLocks: StorageObjectKeyLockService,
    private readonly rateLimiter: AuthRateLimiterService,
  ) {}

  async getProfile(actor: AuthenticatedUser): Promise<ProfileView> {
    const profile = await this.repository.findProfile(actor.id);
    if (!profile) {
      this.throwProfileNotFound();
    }
    return toProfileView(profile);
  }

  async updateProfile(input: {
    actor: AuthenticatedUser;
    dto: UpdateProfileDto;
  }): Promise<ProfileView> {
    const birthDate = this.parseBirthDate(input.dto.birthDate);
    if (
      input.dto.fullName === undefined &&
      input.dto.phone === undefined &&
      input.dto.birthDate === undefined
    ) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'PROFILE_UPDATE_EMPTY',
        'At least one editable profile field is required.',
      );
    }

    const profile = await this.repository.updateProfile({
      userId: input.actor.id,
      dto: input.dto,
      birthDate,
    });
    if (!profile) {
      this.throwProfileNotFound();
    }
    return toProfileView(profile);
  }

  async uploadAvatar(input: {
    actor: AuthenticatedUser;
    file: Express.Multer.File | undefined;
    request: RequestContext;
  }): Promise<ProfileView> {
    if (!input.file) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'IMAGE_FILE_REQUIRED',
        'An image file is required.',
      );
    }

    this.rateLimiter.consumeAvatarUpload(input.actor.id, input.request.ipAddress);
    const optimized = await this.imageProcessing.optimizeImage(input.file.buffer);
    const storageKey = `users/${input.actor.id}/avatar/${randomUUID()}.webp`;

    return this.objectKeyLocks.runExclusive(storageKey, async () =>
      this.uploadAndReplaceAvatar(input.actor.id, storageKey, optimized),
    );
  }

  private async uploadAndReplaceAvatar(
    userId: string,
    storageKey: string,
    optimized: OptimizedImage,
  ): Promise<ProfileView> {
    let uploadedStorageKey: string | undefined;
    try {
      const stored = await this.storage.uploadWebp(storageKey, optimized.buffer);
      uploadedStorageKey = stored.key;
      const result = await this.repository.replaceAvatar({
        userId,
        avatarUrl: stored.url,
        storageKey: stored.key,
      });
      if (result.kind === 'not-found') {
        this.throwProfileNotFound();
      }

      if (result.previousStorageKey !== null && result.previousStorageKey !== stored.key) {
        await this.deleteObjectBestEffort(result.previousStorageKey);
      }
      return toProfileView(result.profile);
    } catch (error) {
      if (uploadedStorageKey) {
        await this.deleteObjectBestEffort(uploadedStorageKey);
      }
      if (error instanceof StorageOperationError) {
        throw new ApplicationException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'OBJECT_STORAGE_UNAVAILABLE',
          'Avatar storage is temporarily unavailable.',
        );
      }
      throw error;
    }
  }

  private async deleteObjectBestEffort(storageKey: string): Promise<void> {
    await this.objectKeyLocks.runExclusive(storageKey, async () => {
      try {
        await this.storage.delete(storageKey);
      } catch {
        // The cleanup scheduler retries an owned object that could not be deleted.
      }
    });
  }

  private parseBirthDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined || value === null) {
      return value;
    }

    const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      year < 1 ||
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'PROFILE_BIRTH_DATE_INVALID',
        'Birth date must be a valid calendar date.',
      );
    }
    return parsed;
  }

  private throwProfileNotFound(): never {
    throw new ApplicationException(HttpStatus.NOT_FOUND, 'PROFILE_NOT_FOUND', 'Profile not found.');
  }
}
