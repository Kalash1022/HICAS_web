import { AuthProvider, Prisma, UserRole, UserStatus } from '@prisma/client';

import type { DatabaseService } from '../../database/database.service';
import { GoogleAuthRepository, type ResolveGoogleIdentityInput } from './google-auth.repository';

const now = new Date('2026-07-23T00:00:00.000Z');
const userId = '0d9417bd-d8f8-43d7-9508-c82f8c99090f';
const identityId = 'c5414142-bbe9-41cb-adfb-d67c81b78156';
const googleInput: ResolveGoogleIdentityInput = {
  providerAccountId: 'google-subject-123',
  providerEmail: 'google@example.com',
  emailNormalized: 'google@example.com',
  fullName: 'Google Customer',
  avatarUrl: 'https://example.com/avatar.png',
  now,
};
const existingUser = {
  id: userId,
  email: 'original@example.com',
  fullName: 'Existing Customer',
  role: UserRole.CUSTOMER,
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
};

describe(GoogleAuthRepository.name, () => {
  it('creates an OAuth transaction without storing raw state or nonce', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'oauth-transaction-id' });
    const repository = new GoogleAuthRepository({
      oauthTransaction: { create },
    } as unknown as DatabaseService);

    await expect(
      repository.createOauthTransaction({
        stateHash: 'state-hash',
        nonceHash: 'nonce-hash',
        pkceVerifierEncrypted: 'encrypted-pkce',
        redirectUri: 'https://shop.example.com/auth/google/callback',
        expiresAt: new Date('2026-07-23T00:10:00.000Z'),
      }),
    ).resolves.toEqual({ transactionId: 'oauth-transaction-id' });

    expect(create).toHaveBeenCalledWith({
      data: {
        stateHash: 'state-hash',
        nonceHash: 'nonce-hash',
        pkceVerifierEncrypted: 'encrypted-pkce',
        redirectUri: 'https://shop.example.com/auth/google/callback',
        expiresAt: new Date('2026-07-23T00:10:00.000Z'),
      },
      select: { id: true },
    });
  });

  it('claims an eligible OAuth transaction with one conditional UPDATE', async () => {
    const queryRaw = jest
      .fn<Promise<unknown[]>, [TemplateStringsArray, ...unknown[]]>()
      .mockResolvedValue([
        {
          transactionId: 'oauth-transaction-id',
          nonceHash: 'nonce-hash',
          pkceVerifierEncrypted: 'encrypted-pkce',
          redirectUri: 'https://shop.example.com/auth/google/callback',
        },
      ]);
    const findUnique = jest.fn();
    const repository = createClaimRepository(queryRaw, findUnique);

    await expect(repository.claimOauthTransaction('state-hash', now)).resolves.toEqual({
      kind: 'claimed',
      transactionId: 'oauth-transaction-id',
      nonceHash: 'nonce-hash',
      pkceVerifierEncrypted: 'encrypted-pkce',
      redirectUri: 'https://shop.example.com/auth/google/callback',
    });

    const statement = queryRaw.mock.calls[0]?.[0].join(' ') ?? '';
    expect(statement).toContain('UPDATE oauth_transactions');
    expect(statement).toContain('consumed_at IS NULL');
    expect(statement).toContain('expires_at >');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing',
      existing: null,
      expected: { kind: 'not-found' },
    },
    {
      name: 'expired',
      existing: {
        consumedAt: null,
        expiresAt: new Date('2026-07-22T23:59:59.999Z'),
      },
      expected: { kind: 'expired' },
    },
    {
      name: 'already used',
      existing: {
        consumedAt: new Date('2026-07-22T23:00:00.000Z'),
        expiresAt: new Date('2026-07-23T00:10:00.000Z'),
      },
      expected: { kind: 'already-used' },
    },
  ])('classifies an unclaimed $name OAuth transaction', async ({ existing, expected }) => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const findUnique = jest.fn().mockResolvedValue(existing);
    const repository = createClaimRepository(queryRaw, findUnique);

    await expect(repository.claimOauthTransaction('state-hash', now)).resolves.toEqual(expected);
  });

  it('resolves by Google sub and never rebinds the application email', async () => {
    const identityFind = jest
      .fn()
      .mockResolvedValueOnce({ id: identityId, userId })
      .mockResolvedValueOnce({
        id: identityId,
        userId,
        providerEmail: 'old-google@example.com',
        user: existingUser,
      });
    const identityUpdate = jest.fn().mockResolvedValue(undefined);
    const userFind = jest.fn();
    const userCreate = jest.fn();
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: userId }]),
      authIdentity: {
        findUnique: identityFind,
        update: identityUpdate,
      },
      user: {
        findUnique: userFind,
        create: userCreate,
      },
    };
    const repository = createResolutionRepository(transaction);

    await expect(repository.resolveGoogleIdentity(googleInput)).resolves.toEqual({
      kind: 'resolved',
      created: false,
      user: existingUser,
    });

    expect(identityUpdate).toHaveBeenCalledWith({
      where: { id: identityId },
      data: { providerEmail: googleInput.providerEmail },
    });
    expect(userFind).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('requires account linking when the email exists without the Google sub', async () => {
    const userCreate = jest.fn();
    const transaction = {
      authIdentity: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: userId }),
        create: userCreate,
      },
    };
    const repository = createResolutionRepository(transaction);

    await expect(repository.resolveGoogleIdentity(googleInput)).resolves.toEqual({
      kind: 'account-link-required',
    });
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('rechecks Google sub before classifying a concurrent email collision', async () => {
    const identityFind = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: identityId, userId })
      .mockResolvedValueOnce({
        id: identityId,
        userId,
        providerEmail: googleInput.providerEmail,
        user: existingUser,
      });
    const transaction = {
      authIdentity: {
        findUnique: identityFind,
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: userId }),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: userId }]),
    };
    const repository = createResolutionRepository(transaction);

    await expect(repository.resolveGoogleIdentity(googleInput)).resolves.toEqual({
      kind: 'resolved',
      created: false,
      user: existingUser,
    });
    expect(identityFind.mock.calls).toHaveLength(3);
    expect(transaction.user.create).not.toHaveBeenCalled();
  });

  it('nested-creates an ACTIVE Customer and Google identity', async () => {
    const userCreate = jest.fn().mockResolvedValue({
      id: userId,
      email: googleInput.providerEmail,
      fullName: googleInput.fullName,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: now,
    });
    const transaction = {
      authIdentity: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: userCreate,
      },
    };
    const repository = createResolutionRepository(transaction);

    await expect(repository.resolveGoogleIdentity(googleInput)).resolves.toMatchObject({
      kind: 'resolved',
      created: true,
      user: {
        id: userId,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
    });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          email: googleInput.providerEmail,
          emailNormalized: googleInput.emailNormalized,
          fullName: googleInput.fullName,
          avatarUrl: googleInput.avatarUrl,
          role: UserRole.CUSTOMER,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: now,
          authIdentities: {
            create: {
              provider: AuthProvider.GOOGLE,
              providerAccountId: googleInput.providerAccountId,
              providerEmail: googleInput.providerEmail,
            },
          },
        },
      }),
    );
  });

  it.each([
    ['user email', ['email_normalized']],
    ['Google identity', 'auth_identities_provider_account_key'],
  ])('retries a bounded %s unique race', async (_name, target) => {
    const transaction = {
      authIdentity: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: identityId, userId })
          .mockResolvedValueOnce({
            id: identityId,
            userId,
            providerEmail: googleInput.providerEmail,
            user: existingUser,
          }),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: userId }]),
    };
    const runTransaction = jest
      .fn()
      .mockRejectedValueOnce(uniqueError(target))
      .mockImplementationOnce(
        (operation: (client: typeof transaction) => Promise<unknown>): Promise<unknown> =>
          operation(transaction),
      );
    const repository = new GoogleAuthRepository({
      $transaction: runTransaction,
    } as unknown as DatabaseService);

    await expect(repository.resolveGoogleIdentity(googleInput)).resolves.toMatchObject({
      kind: 'resolved',
      created: false,
      user: { id: userId },
    });
    expect(runTransaction.mock.calls).toHaveLength(2);
  });

  it('does not retry an unrelated P2002 constraint', async () => {
    const runTransaction = jest.fn().mockRejectedValue(uniqueError(['refresh_token_hash']));
    const repository = new GoogleAuthRepository({
      $transaction: runTransaction,
    } as unknown as DatabaseService);

    await expect(repository.resolveGoogleIdentity(googleInput)).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(runTransaction.mock.calls).toHaveLength(1);
  });
});

function createClaimRepository(queryRaw: jest.Mock, findUnique: jest.Mock): GoogleAuthRepository {
  const transaction = {
    $queryRaw: queryRaw,
    oauthTransaction: { findUnique },
  };
  const database = {
    $transaction: (operation: (client: typeof transaction) => Promise<unknown>): Promise<unknown> =>
      operation(transaction),
  };

  return new GoogleAuthRepository(database as unknown as DatabaseService);
}

function createResolutionRepository(transaction: object): GoogleAuthRepository {
  const database = {
    $transaction: (operation: (client: typeof transaction) => Promise<unknown>): Promise<unknown> =>
      operation(transaction),
  };

  return new GoogleAuthRepository(database as unknown as DatabaseService);
}

function uniqueError(target: string | string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed.', {
    code: 'P2002',
    clientVersion: '6.19.0',
    meta: { target },
  });
}
