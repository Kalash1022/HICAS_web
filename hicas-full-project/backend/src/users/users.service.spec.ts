import { UserRole, UserStatus } from '@prisma/client';
import { Readable } from 'node:stream';

import type { AuthRateLimiterService } from '../auth/services/auth-rate-limiter.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { ImageProcessingService } from '../uploads/image-processing.service';
import { ObjectStorageService, StorageOperationError } from '../uploads/object-storage.service';
import { StorageObjectKeyLockService } from '../uploads/storage-object-key-lock.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import type { ProfileRecord } from './users.types';

const userId = '11111111-1111-4111-8111-111111111111';
const actor: AuthenticatedUser = {
  id: userId,
  email: 'customer@example.com',
  fullName: 'Customer',
  role: UserRole.CUSTOMER,
  sessionId: 'session-id',
};
const now = new Date('2026-08-03T00:00:00.000Z');

function profileRecord(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: userId,
    email: 'customer@example.com',
    fullName: 'Customer',
    phone: null,
    avatarUrl: null,
    birthDate: new Date('1990-01-31T00:00:00.000Z'),
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function uploadFile(): Express.Multer.File {
  const buffer = Buffer.from('image');
  return {
    fieldname: 'image',
    originalname: 'avatar.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: buffer.length,
    stream: Readable.from(buffer),
    destination: '',
    filename: 'avatar.png',
    path: '',
    buffer,
  };
}

describe(UsersService.name, () => {
  let findProfile: jest.MockedFunction<UsersRepository['findProfile']>;
  let updateProfile: jest.MockedFunction<UsersRepository['updateProfile']>;
  let replaceAvatar: jest.MockedFunction<UsersRepository['replaceAvatar']>;
  let optimizeImage: jest.MockedFunction<ImageProcessingService['optimizeImage']>;
  let uploadWebp: jest.MockedFunction<ObjectStorageService['uploadWebp']>;
  let deleteObject: jest.MockedFunction<ObjectStorageService['delete']>;
  let consumeAvatarUpload: jest.MockedFunction<AuthRateLimiterService['consumeAvatarUpload']>;
  let service: UsersService;

  beforeEach(() => {
    findProfile = jest.fn();
    updateProfile = jest.fn();
    replaceAvatar = jest.fn();
    optimizeImage = jest.fn();
    uploadWebp = jest.fn();
    deleteObject = jest.fn();
    consumeAvatarUpload = jest.fn();

    const repository = {
      findProfile,
      updateProfile,
      replaceAvatar,
    } as unknown as UsersRepository;
    const storage = {
      uploadWebp,
      delete: deleteObject,
    } as unknown as ObjectStorageService;
    const runExclusive = <T>(_key: string, operation: () => Promise<T>): Promise<T> => operation();

    service = new UsersService(
      repository,
      { optimizeImage } as unknown as ImageProcessingService,
      storage,
      { runExclusive } as unknown as StorageObjectKeyLockService,
      { consumeAvatarUpload } as unknown as AuthRateLimiterService,
    );
  });

  it('reads only the profile identified by the authenticated user', async () => {
    findProfile.mockResolvedValue(profileRecord());

    await expect(service.getProfile(actor)).resolves.toMatchObject({
      id: userId,
      birthDate: '1990-01-31',
    });
    expect(findProfile).toHaveBeenCalledWith(userId);
  });

  it('updates the actor-owned allow-list and retains a calendar date without timezone drift', async () => {
    const updated = profileRecord({
      fullName: 'Updated Customer',
      phone: '0901234567',
      birthDate: new Date('2000-02-29T00:00:00.000Z'),
    });
    updateProfile.mockResolvedValue(updated);

    await expect(
      service.updateProfile({
        actor,
        dto: {
          fullName: 'Updated Customer',
          phone: '0901234567',
          birthDate: '2000-02-29',
        },
      }),
    ).resolves.toMatchObject({
      fullName: 'Updated Customer',
      phone: '0901234567',
      birthDate: '2000-02-29',
    });

    expect(updateProfile).toHaveBeenCalledWith({
      userId,
      dto: {
        fullName: 'Updated Customer',
        phone: '0901234567',
        birthDate: '2000-02-29',
      },
      birthDate: new Date('2000-02-29T00:00:00.000Z'),
    });
  });

  it('rejects an empty profile patch and impossible calendar dates', async () => {
    await expect(service.updateProfile({ actor, dto: {} })).rejects.toMatchObject({
      status: 400,
      response: { code: 'PROFILE_UPDATE_EMPTY' },
    });
    await expect(
      service.updateProfile({ actor, dto: { birthDate: '2026-02-29' } }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'PROFILE_BIRTH_DATE_INVALID' },
    });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('does not disclose or update a profile that disappears after authentication', async () => {
    updateProfile.mockResolvedValue(null);

    await expect(
      service.updateProfile({ actor, dto: { fullName: 'Updated Customer' } }),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'PROFILE_NOT_FOUND' },
    });
    expect(updateProfile).toHaveBeenCalledWith({
      userId,
      dto: { fullName: 'Updated Customer' },
      birthDate: undefined,
    });
  });

  it('requires a file before creating an avatar object', async () => {
    await expect(
      service.uploadAvatar({ actor, file: undefined, request: {} }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'IMAGE_FILE_REQUIRED' },
    });
    expect(uploadWebp).not.toHaveBeenCalled();
  });

  it('stores a server-owned avatar key and leaves an external Google avatar untouched', async () => {
    const optimized = { buffer: Buffer.from('webp'), contentType: 'image/webp' as const };
    const storageKeyPattern =
      /^users\/11111111-1111-4111-8111-111111111111\/avatar\/[0-9a-f-]{36}\.webp$/;
    optimizeImage.mockResolvedValue(optimized);
    uploadWebp.mockImplementation((key) =>
      Promise.resolve({ key, url: 'https://cdn.example/' + key }),
    );
    replaceAvatar.mockImplementation(({ storageKey }) =>
      Promise.resolve({
        kind: 'updated',
        profile: profileRecord({ avatarUrl: 'https://cdn.example/' + storageKey }),
        previousStorageKey: null,
      }),
    );

    const profile = await service.uploadAvatar({
      actor,
      file: uploadFile(),
      request: { ipAddress: '127.0.0.1' },
    });
    expect(profile.avatarUrl?.startsWith('https://cdn.example/users/')).toBe(true);

    const uploadInput = uploadWebp.mock.calls[0];
    const replacementInput = replaceAvatar.mock.calls[0]?.[0];
    expect(uploadInput?.[0]).toMatch(storageKeyPattern);
    expect(uploadInput?.[1]).toBe(optimized.buffer);
    expect(replacementInput).toEqual({
      userId,
      avatarUrl: 'https://cdn.example/' + replacementInput?.storageKey,
      storageKey: replacementInput?.storageKey,
    });
    expect(replacementInput?.storageKey).toMatch(storageKeyPattern);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(consumeAvatarUpload).toHaveBeenCalledWith(userId, '127.0.0.1');
  });

  it('deletes a superseded owned avatar only after its replacement is linked', async () => {
    const oldStorageKey = 'users/11111111-1111-4111-8111-111111111111/avatar/old.webp';
    optimizeImage.mockResolvedValue({ buffer: Buffer.from('webp'), contentType: 'image/webp' });
    uploadWebp.mockImplementation((key) =>
      Promise.resolve({ key, url: 'https://cdn.example/' + key }),
    );
    replaceAvatar.mockResolvedValue({
      kind: 'updated',
      profile: profileRecord({ avatarUrl: 'https://cdn.example/new.webp' }),
      previousStorageKey: oldStorageKey,
    });
    deleteObject.mockResolvedValue(undefined);

    await service.uploadAvatar({ actor, file: uploadFile(), request: {} });

    expect(deleteObject).toHaveBeenCalledWith(oldStorageKey);
  });

  it('removes a newly uploaded object when its database link cannot be created', async () => {
    optimizeImage.mockResolvedValue({ buffer: Buffer.from('webp'), contentType: 'image/webp' });
    uploadWebp.mockResolvedValue({
      key: 'users/11111111-1111-4111-8111-111111111111/avatar/new.webp',
      url: 'https://cdn.example/new.webp',
    });
    replaceAvatar.mockRejectedValue(new Error('database unavailable'));
    deleteObject.mockResolvedValue(undefined);

    await expect(service.uploadAvatar({ actor, file: uploadFile(), request: {} })).rejects.toThrow(
      'database unavailable',
    );
    expect(deleteObject).toHaveBeenCalledWith(
      'users/11111111-1111-4111-8111-111111111111/avatar/new.webp',
    );
  });

  it('maps object-storage outages to a safe availability response', async () => {
    optimizeImage.mockResolvedValue({ buffer: Buffer.from('webp'), contentType: 'image/webp' });
    uploadWebp.mockRejectedValue(new StorageOperationError('upload'));

    await expect(
      service.uploadAvatar({ actor, file: uploadFile(), request: {} }),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'OBJECT_STORAGE_UNAVAILABLE' },
    });
    expect(replaceAvatar).not.toHaveBeenCalled();
  });
});
