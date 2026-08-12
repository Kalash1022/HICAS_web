import type { DatabaseService } from '../database/database.service';
import { UsersRepository } from './users.repository';
import type { ProfileRecord } from './users.types';

const userId = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-08-03T00:00:00.000Z');

function profileRecord(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: userId,
    email: 'customer@example.com',
    fullName: 'Customer',
    phone: null,
    avatarUrl: null,
    birthDate: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe(UsersRepository.name, () => {
  it('selects a curated profile by the authenticated user id', async () => {
    const findUnique = jest.fn().mockResolvedValue(profileRecord());
    const repository = new UsersRepository({
      user: { findUnique },
    } as unknown as DatabaseService);

    await expect(repository.findProfile(userId)).resolves.toMatchObject({ id: userId });

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: userId } }));
  });

  it('updates only the allowed profile fields for the supplied user id', async () => {
    const update = jest.fn().mockResolvedValue(profileRecord({ phone: '0901234567' }));
    const repository = new UsersRepository({
      user: { update },
    } as unknown as DatabaseService);

    await expect(
      repository.updateProfile({
        userId,
        dto: { phone: '0901234567' },
        birthDate: undefined,
      }),
    ).resolves.toMatchObject({ phone: '0901234567' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: { phone: '0901234567' },
      }),
    );
  });

  it('locks the user before replacing the owned avatar storage key', async () => {
    const oldStorageKey = 'users/11111111-1111-4111-8111-111111111111/avatar/old.webp';
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: userId, avatarStorageKey: oldStorageKey }]),
      user: {
        update: jest
          .fn()
          .mockResolvedValue(profileRecord({ avatarUrl: 'https://cdn.example/new.webp' })),
      },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new UsersRepository(database);

    await expect(
      repository.replaceAvatar({
        userId,
        avatarUrl: 'https://cdn.example/new.webp',
        storageKey: 'users/11111111-1111-4111-8111-111111111111/avatar/new.webp',
      }),
    ).resolves.toMatchObject({
      kind: 'updated',
      previousStorageKey: oldStorageKey,
    });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: {
          avatarUrl: 'https://cdn.example/new.webp',
          avatarStorageKey: 'users/11111111-1111-4111-8111-111111111111/avatar/new.webp',
        },
      }),
    );
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.user.update.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
