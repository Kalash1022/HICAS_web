import { UserRole, UserStatus } from '@prisma/client';

import type { PrismaClient } from '@prisma/client';
import {
  ensureInitialAdmin,
  InitialAdminBootstrapError,
  readInitialAdminBootstrapConfiguration,
} from '../../prisma/seed';

function databaseWithUsers(input: {
  configuredEmailUser: {
    role: UserRole;
    status: UserStatus;
    emailVerifiedAt?: Date | null;
  } | null;
  activeAdmin?: { id: string } | null;
}) {
  const findUnique = jest.fn().mockResolvedValue(
    input.configuredEmailUser === null
      ? null
      : {
          ...input.configuredEmailUser,
          emailVerifiedAt:
            input.configuredEmailUser.emailVerifiedAt === undefined
              ? new Date()
              : input.configuredEmailUser.emailVerifiedAt,
        },
  );
  const findFirst = jest.fn().mockResolvedValue(input.activeAdmin ?? null);
  const create = jest.fn().mockResolvedValue({ id: 'admin-id' });
  const executeRaw = jest.fn().mockResolvedValue(1);
  const transaction = {
    $executeRaw: executeRaw,
    user: { findFirst, findUnique, create },
  };

  return {
    database: {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as Pick<PrismaClient, '$transaction'>,
    findUnique,
    findFirst,
    create,
    executeRaw,
  };
}

const enabledEnvironment = {
  INITIAL_ADMIN_BOOTSTRAP_ENABLED: 'true',
  DIRECT_URL: 'postgresql://seed:password@localhost:5432/hicas',
  INITIAL_ADMIN_EMAIL: ' Admin@Example.com ',
  INITIAL_ADMIN_FULL_NAME: 'Initial Admin',
  INITIAL_ADMIN_PASSWORD: 'correct horse battery staple',
};

describe('initial Admin bootstrap', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(readInitialAdminBootstrapConfiguration({})).toBeNull();
    expect(
      readInitialAdminBootstrapConfiguration({
        ...enabledEnvironment,
        INITIAL_ADMIN_BOOTSTRAP_ENABLED: 'TRUE',
      }),
    ).toBeNull();
  });

  it('requires the direct connection and validates bootstrap fields', () => {
    expect(() =>
      readInitialAdminBootstrapConfiguration({
        ...enabledEnvironment,
        DIRECT_URL: '',
      }),
    ).toThrow(InitialAdminBootstrapError);
    expect(() =>
      readInitialAdminBootstrapConfiguration({
        ...enabledEnvironment,
        INITIAL_ADMIN_EMAIL: 'not-an-email',
      }),
    ).toThrow('INITIAL_ADMIN_EMAIL must be a valid email address.');

    expect(readInitialAdminBootstrapConfiguration(enabledEnvironment)).toMatchObject({
      directUrl: enabledEnvironment.DIRECT_URL,
      email: 'Admin@Example.com',
      emailNormalized: 'admin@example.com',
      fullName: 'Initial Admin',
    });
  });

  it('creates a verified active Admin with only a password credential', async () => {
    const { database, create, executeRaw, findFirst, findUnique } = databaseWithUsers({
      configuredEmailUser: null,
    });
    const now = new Date('2026-08-03T00:00:00.000Z');

    await expect(
      ensureInitialAdmin(database, {
        email: 'Admin@example.com',
        emailNormalized: 'admin@example.com',
        fullName: 'Initial Admin',
        passwordHash: 'argon2-hash',
        now,
      }),
    ).resolves.toBe('created');

    expect(create).toHaveBeenCalledWith({
      data: {
        email: 'Admin@example.com',
        emailNormalized: 'admin@example.com',
        fullName: 'Initial Admin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: now,
        passwordCredential: {
          create: { passwordHash: 'argon2-hash' },
        },
      },
    });
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findUnique.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      findFirst.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('does not mutate an existing active Admin, even when it uses another email', async () => {
    const { database, create, findUnique } = databaseWithUsers({
      configuredEmailUser: null,
      activeAdmin: { id: 'existing-admin-id' },
    });

    await expect(
      ensureInitialAdmin(database, {
        email: 'Admin@example.com',
        emailNormalized: 'admin@example.com',
        fullName: 'Initial Admin',
        passwordHash: 'argon2-hash',
      }),
    ).resolves.toBe('already-exists');
    expect(create).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalledWith({
      where: { emailNormalized: 'admin@example.com' },
      select: {
        role: true,
        status: true,
        emailVerifiedAt: true,
      },
    });
  });

  it('treats a concurrent active-Admin creation as an idempotent no-op', async () => {
    const { database, create, findFirst, findUnique } = databaseWithUsers({
      configuredEmailUser: null,
    });
    create.mockRejectedValueOnce({ code: 'P2002' });
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'raced-admin-id' });

    await expect(
      ensureInitialAdmin(database, {
        email: 'Admin@example.com',
        emailNormalized: 'admin@example.com',
        fullName: 'Initial Admin',
        passwordHash: 'argon2-hash',
      }),
    ).resolves.toBe('already-exists');
    expect(create).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('refuses to change an existing non-Admin account', async () => {
    const { database, create } = databaseWithUsers({
      configuredEmailUser: {
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
    });

    await expect(
      ensureInitialAdmin(database, {
        email: 'Admin@example.com',
        emailNormalized: 'admin@example.com',
        fullName: 'Initial Admin',
        passwordHash: 'argon2-hash',
      }),
    ).rejects.toThrow('configured bootstrap email already belongs to a non-active-Admin account');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an unverified active Admin record instead of treating it as a usable bootstrap result', async () => {
    const { database, create } = databaseWithUsers({
      configuredEmailUser: {
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: null,
      },
    });

    await expect(
      ensureInitialAdmin(database, {
        email: 'Admin@example.com',
        emailNormalized: 'admin@example.com',
        fullName: 'Initial Admin',
        passwordHash: 'argon2-hash',
      }),
    ).rejects.toThrow('configured bootstrap email already belongs to a non-active-Admin account');
    expect(create).not.toHaveBeenCalled();
  });
});
