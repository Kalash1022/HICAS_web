import { MfaTotpStatus, PrimaryAuthMethod, UserRole, UserStatus } from '@prisma/client';

import type { DatabaseService } from '../../database/database.service';
import { MfaRepository } from './mfa.repository';

const userId = '0d9417bd-d8f8-43d7-9508-c82f8c99090f';
const methodId = '061e7c0a-e67d-4bd5-b921-816db6bac958';
const grantId = 'c5414142-bbe9-41cb-adfb-d67c81b78156';
const challengeId = '79e85d56-40d8-4730-adfe-f01352acc117';
const recoveryCodeId = '91af0d93-34f6-46bb-bb98-9db10d1d9f9e';
const sessionId = '0f79f787-1644-47e2-b7ad-49e44d3dc793';
const now = new Date('2026-07-23T00:00:00.000Z');
const future = new Date('2026-07-23T00:10:00.000Z');
const secretEncrypted = 'v1.encrypted-totp-secret';
const recoveryCodeHash = 'f'.repeat(64);

const pendingUser = {
  id: userId,
  email: 'staff@example.com',
  fullName: 'Staff User',
  role: UserRole.STAFF,
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
  mfaTotpMethod: {
    id: methodId,
    status: MfaTotpStatus.PENDING,
    secretEncrypted,
    setupExpiresAt: future,
  },
};

const enabledUser = {
  ...pendingUser,
  mfaTotpMethod: {
    id: methodId,
    status: MfaTotpStatus.ENABLED,
    secretEncrypted,
  },
};

const validGrant = {
  id: grantId,
  userId,
  expiresAt: future,
  consumedAt: null,
  revokedAt: null,
};

const validChallenge = {
  id: challengeId,
  userId,
  primaryMethod: PrimaryAuthMethod.PASSWORD,
  attemptCount: 0,
  maxAttempts: 5,
  expiresAt: future,
  consumedAt: null,
};

describe(MfaRepository.name, () => {
  it('locks the User row before reading eligibility and upserting a pending setup', async () => {
    const events: string[] = [];
    const harness = createHarness({ user: pendingUser, grant: validGrant });
    harness.mocks.queryRaw.mockImplementation(() => {
      events.push('lock-user');
      return Promise.resolve([{ id: userId }]);
    });
    harness.mocks.userFindUnique.mockImplementation(() => {
      events.push('read-user');
      return Promise.resolve(pendingUser);
    });
    harness.mocks.grantFindUnique.mockImplementation(() => {
      events.push('read-grant');
      return Promise.resolve(validGrant);
    });
    harness.mocks.methodUpsert.mockImplementation(() => {
      events.push('upsert-method');
      return Promise.resolve({});
    });

    await expect(
      harness.repository.savePendingSetup({
        userId,
        enrollmentTokenHash: 'enrollment-token-hash',
        secretEncrypted,
        setupExpiresAt: future,
        now,
      }),
    ).resolves.toMatchObject({
      kind: 'saved',
      email: pendingUser.email,
      setupExpiresAt: future,
    });

    expect(events).toEqual(['lock-user', 'read-user', 'read-grant', 'upsert-method']);
    expect(firstCallArgument(harness.mocks.methodUpsert)).toMatchObject({
      where: { userId },
      create: {
        userId,
        secretEncrypted,
        status: MfaTotpStatus.PENDING,
      },
    });
  });

  it('completes method, ten recovery hashes, grant, event, and session in one transaction', async () => {
    const hashes = createRecoveryCodeHashes();
    const harness = createHarness({ user: pendingUser, grant: validGrant });

    const result = await harness.repository.completeEnrollment({
      userId,
      enrollmentTokenHash: 'enrollment-token-hash',
      expectedSecretEncrypted: secretEncrypted,
      candidateTimeStep: 5_829_120n,
      recoveryCodeHashes: hashes,
      refreshTtlDays: 14,
      context: {
        ipAddress: '127.0.0.1',
        userAgent: 'repository-spec',
      },
      now,
    });

    expect(result).toMatchObject({
      kind: 'completed',
      sessionId,
      user: {
        id: userId,
        role: UserRole.STAFF,
      },
    });
    expect(harness.mocks.transaction).toHaveBeenCalledTimes(1);
    expect(firstCallArgument(harness.mocks.methodUpdateMany)).toMatchObject({
      where: {
        id: methodId,
        userId,
        status: MfaTotpStatus.PENDING,
        secretEncrypted,
        setupExpiresAt: { gt: now },
      },
      data: {
        status: MfaTotpStatus.ENABLED,
        setupExpiresAt: null,
        enabledAt: now,
        lastUsedTimeStep: 5_829_120n,
      },
    });
    expect(firstCallArgument(harness.mocks.grantUpdateMany)).toMatchObject({
      where: {
        id: grantId,
        userId,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    expect(firstCallArgument(harness.mocks.recoveryCreateMany)).toEqual({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    });
    expect(firstCallArgument(harness.mocks.securityEventCreate)).toMatchObject({
      data: {
        userId,
        type: 'MFA_CHANGED',
        metadata: { action: 'ENABLED' },
      },
    });
    expect(harness.mocks.sessionCreate).toHaveBeenCalledTimes(1);
  });

  it('rolls back enrollment through a sentinel result when a conditional guard loses', async () => {
    const harness = createHarness({
      user: pendingUser,
      grant: validGrant,
      methodUpdateCount: 0,
    });

    await expect(
      harness.repository.completeEnrollment({
        userId,
        enrollmentTokenHash: 'enrollment-token-hash',
        expectedSecretEncrypted: secretEncrypted,
        candidateTimeStep: 5_829_120n,
        recoveryCodeHashes: createRecoveryCodeHashes(),
        refreshTtlDays: 14,
        context: {},
        now,
      }),
    ).resolves.toEqual({ kind: 'setup-required' });

    expect(harness.mocks.grantUpdateMany).not.toHaveBeenCalled();
    expect(harness.mocks.recoveryCreateMany).not.toHaveBeenCalled();
    expect(harness.mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('commits an invalid challenge attempt and returns without throwing', async () => {
    const harness = createHarness({ user: enabledUser, challenge: validChallenge });

    await expect(
      harness.repository.completeChallenge({
        userId,
        challengeTokenHash: 'challenge-token-hash',
        credential: {
          kind: 'totp',
          expectedSecretEncrypted: secretEncrypted,
          candidateTimeStep: null,
        },
        refreshTtlDays: 14,
        context: {},
        now,
      }),
    ).resolves.toEqual({ kind: 'invalid-credential' });

    expect(harness.mocks.challengeUpdateMany).toHaveBeenCalledTimes(1);
    expect(firstCallArgument(harness.mocks.challengeUpdateMany)).toEqual({
      where: {
        id: challengeId,
        userId,
        consumedAt: null,
        expiresAt: { gt: now },
        attemptCount: {
          equals: 0,
          lt: 5,
        },
      },
      data: { attemptCount: { increment: 1 } },
    });
    expect(harness.mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('marks the fifth failed attempt exhausted while preserving the guarded increment', async () => {
    const harness = createHarness({
      user: enabledUser,
      challenge: {
        ...validChallenge,
        attemptCount: 4,
      },
    });

    await expect(
      harness.repository.completeChallenge({
        userId,
        challengeTokenHash: 'challenge-token-hash',
        credential: {
          kind: 'totp',
          expectedSecretEncrypted: secretEncrypted,
          candidateTimeStep: null,
        },
        refreshTtlDays: 14,
        context: {},
        now,
      }),
    ).resolves.toEqual({ kind: 'attempts-exhausted' });

    expect(firstCallArgument(harness.mocks.challengeUpdateMany)).toMatchObject({
      where: {
        attemptCount: {
          equals: 4,
          lt: 5,
        },
      },
      data: { attemptCount: { increment: 1 } },
    });
    expect(harness.mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('uses an atomic last-used-step condition before consuming a TOTP challenge', async () => {
    const harness = createHarness({ user: enabledUser, challenge: validChallenge });
    const candidateTimeStep = 5_829_120n;

    await expect(
      harness.repository.completeChallenge({
        userId,
        challengeTokenHash: 'challenge-token-hash',
        credential: {
          kind: 'totp',
          expectedSecretEncrypted: secretEncrypted,
          candidateTimeStep,
        },
        refreshTtlDays: 14,
        context: {},
        now,
      }),
    ).resolves.toMatchObject({ kind: 'completed', sessionId });

    expect(firstCallArgument(harness.mocks.methodUpdateMany)).toEqual({
      where: {
        id: methodId,
        userId,
        status: MfaTotpStatus.ENABLED,
        secretEncrypted,
        OR: [{ lastUsedTimeStep: null }, { lastUsedTimeStep: { lt: candidateTimeStep } }],
      },
      data: { lastUsedTimeStep: candidateTimeStep },
    });
    expect(firstCallArgument(harness.mocks.challengeUpdateMany)).toMatchObject({
      where: {
        id: challengeId,
        userId,
        consumedAt: null,
        expiresAt: { gt: now },
        attemptCount: { lt: 5 },
      },
      data: { consumedAt: now },
    });
  });

  it('consumes one recovery code and records a redacted recovery security event', async () => {
    const harness = createHarness({
      user: enabledUser,
      challenge: validChallenge,
      recoveryCode: { id: recoveryCodeId },
    });

    await expect(
      harness.repository.completeChallenge({
        userId,
        challengeTokenHash: 'challenge-token-hash',
        credential: {
          kind: 'recovery',
          recoveryCodeHash,
        },
        refreshTtlDays: 14,
        context: {
          ipAddress: '127.0.0.1',
          userAgent: 'repository-spec',
        },
        now,
      }),
    ).resolves.toMatchObject({ kind: 'completed', sessionId });

    expect(firstCallArgument(harness.mocks.recoveryUpdateMany)).toEqual({
      where: {
        id: recoveryCodeId,
        userId,
        usedAt: null,
      },
      data: { usedAt: now },
    });
    const eventData = firstCallArgument(harness.mocks.securityEventCreate);
    expect(eventData).toEqual({
      data: {
        userId,
        type: 'MFA_RECOVERY_CODE_USED',
        ipAddress: '127.0.0.1',
        userAgent: 'repository-spec',
        metadata: {
          challengeId,
          primaryMethod: PrimaryAuthMethod.PASSWORD,
        },
      },
    });
    expect(JSON.stringify(eventData)).not.toContain(recoveryCodeHash);
    expect(JSON.stringify(eventData).toLowerCase()).not.toContain('recoverycode');
  });

  it('does not create a session when the final challenge-consume guard loses', async () => {
    const harness = createHarness({
      user: enabledUser,
      challenge: validChallenge,
      methodUpdateCount: 1,
      challengeUpdateCount: 0,
    });

    await expect(
      harness.repository.completeChallenge({
        userId,
        challengeTokenHash: 'challenge-token-hash',
        credential: {
          kind: 'totp',
          expectedSecretEncrypted: secretEncrypted,
          candidateTimeStep: 5_829_120n,
        },
        refreshTtlDays: 14,
        context: {},
        now,
      }),
    ).resolves.toEqual({ kind: 'invalid' });

    expect(harness.mocks.sessionCreate).not.toHaveBeenCalled();
    expect(harness.mocks.securityEventCreate).not.toHaveBeenCalled();
  });

  it('returns invalid when a concurrent failed-attempt update no longer matches its snapshot', async () => {
    const harness = createHarness({
      user: enabledUser,
      challenge: validChallenge,
      challengeUpdateCount: 0,
    });

    await expect(
      harness.repository.completeChallenge({
        userId,
        challengeTokenHash: 'challenge-token-hash',
        credential: {
          kind: 'totp',
          expectedSecretEncrypted: secretEncrypted,
          candidateTimeStep: null,
        },
        refreshTtlDays: 14,
        context: {},
        now,
      }),
    ).resolves.toEqual({ kind: 'invalid' });

    expect(harness.mocks.sessionCreate).not.toHaveBeenCalled();
  });
});

function createRecoveryCodeHashes(): string[] {
  return Array.from({ length: 10 }, (_value, index) => index.toString(16).padStart(64, '0'));
}

function firstCallArgument(mock: jest.Mock): unknown {
  const calls = mock.mock.calls as unknown[][];
  return calls[0]?.[0];
}

function createHarness(input: {
  user: unknown;
  grant?: unknown;
  challenge?: unknown;
  recoveryCode?: unknown;
  methodUpdateCount?: number;
  challengeUpdateCount?: number;
}): {
  repository: MfaRepository;
  mocks: {
    transaction: jest.Mock;
    queryRaw: jest.Mock;
    userFindUnique: jest.Mock;
    grantFindUnique: jest.Mock;
    grantUpdateMany: jest.Mock;
    methodUpsert: jest.Mock;
    methodUpdateMany: jest.Mock;
    challengeUpdateMany: jest.Mock;
    recoveryCreateMany: jest.Mock;
    recoveryUpdateMany: jest.Mock;
    securityEventCreate: jest.Mock;
    sessionCreate: jest.Mock;
  };
} {
  const queryRaw = jest.fn().mockResolvedValue([{ id: userId }]);
  const userFindUnique = jest.fn().mockResolvedValue(input.user);
  const grantFindUnique = jest.fn().mockResolvedValue(input.grant ?? null);
  const grantUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const methodUpsert = jest.fn().mockResolvedValue({});
  const methodUpdateMany = jest.fn().mockResolvedValue({ count: input.methodUpdateCount ?? 1 });
  const challengeUpdateMany = jest
    .fn()
    .mockResolvedValue({ count: input.challengeUpdateCount ?? 1 });
  const recoveryCreateMany = jest.fn().mockResolvedValue({ count: 10 });
  const recoveryUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const securityEventCreate = jest.fn().mockResolvedValue({});
  const sessionCreate = jest.fn().mockResolvedValue({ id: sessionId });
  const transactionClient = {
    $queryRaw: queryRaw,
    user: {
      findUnique: userFindUnique,
    },
    mfaEnrollmentGrant: {
      findUnique: grantFindUnique,
      updateMany: grantUpdateMany,
    },
    mfaTotpMethod: {
      upsert: methodUpsert,
      updateMany: methodUpdateMany,
    },
    mfaChallenge: {
      findUnique: jest.fn().mockResolvedValue(input.challenge ?? null),
      updateMany: challengeUpdateMany,
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    mfaRecoveryCode: {
      findFirst: jest.fn().mockResolvedValue(input.recoveryCode ?? null),
      updateMany: recoveryUpdateMany,
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: recoveryCreateMany,
    },
    securityEvent: {
      create: securityEventCreate,
    },
    session: {
      create: sessionCreate,
    },
  };
  const transaction = jest.fn(
    (operation: (client: typeof transactionClient) => Promise<unknown>): Promise<unknown> =>
      operation(transactionClient),
  );
  const database = {
    $transaction: transaction,
  } as unknown as DatabaseService;

  return {
    repository: new MfaRepository(database),
    mocks: {
      transaction,
      queryRaw,
      userFindUnique,
      grantFindUnique,
      grantUpdateMany,
      methodUpsert,
      methodUpdateMany,
      challengeUpdateMany,
      recoveryCreateMany,
      recoveryUpdateMany,
      securityEventCreate,
      sessionCreate,
    },
  };
}
