import { AuditAction, MfaTotpStatus, UserRole, UserStatus } from '@prisma/client';

import type { DatabaseService } from '../database/database.service';
import { AdministrationRepository } from './administration.repository';

const actorId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-07-24T00:00:00.000Z');

describe(AdministrationRepository.name, () => {
  it('locks active administrators before refusing to block the final active Admin', async () => {
    const transaction = createTransaction({
      user: {
        findUnique: jest.fn().mockResolvedValue(adminUser()),
        update: jest.fn(),
      },
    });
    transaction.$queryRaw.mockResolvedValue([{ id: targetId }]);
    const repository = createRepository(transaction);

    await expect(
      repository.updateStatus({
        actorId,
        targetUserId: targetId,
        requestedStatus: UserStatus.BLOCKED,
        requestId: 'request-id',
        request: {},
        now,
      }),
    ).resolves.toEqual({ kind: 'last-active-admin' });

    expect(transaction.$queryRaw.mock.calls).toHaveLength(2);
    expect(transaction.user.update.mock.calls).toHaveLength(0);
  });

  it('revokes current sessions and writes an audit entry when blocking a user', async () => {
    const original = customerUser();
    const updated = { ...original, status: UserStatus.BLOCKED };
    const transaction = createTransaction({
      user: {
        findUnique: jest.fn().mockResolvedValue(original),
        update: jest.fn().mockResolvedValue(updated),
      },
    });
    transaction.$queryRaw.mockResolvedValue([{ id: actorId }]);
    const repository = createRepository(transaction);

    await expect(
      repository.updateStatus({
        actorId,
        targetUserId: targetId,
        requestedStatus: UserStatus.BLOCKED,
        requestId: 'request-id',
        request: { ipAddress: '127.0.0.1' },
        now,
      }),
    ).resolves.toMatchObject({
      kind: 'updated',
      changed: true,
      user: { status: UserStatus.BLOCKED },
    });

    expect(transaction.session.updateMany).toHaveBeenCalledWith({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: now },
    });
    expect(transaction.mfaEnrollmentGrant.updateMany.mock.calls).toHaveLength(1);
    expect(transaction.mfaChallenge.deleteMany.mock.calls).toHaveLength(1);
    expectFirstCallToMatch(transaction.auditLog.create, {
      data: {
        actorId,
        action: AuditAction.USER_BLOCKED,
        entityId: targetId,
        requestId: 'request-id',
      },
    });
  });

  it('downgrades Staff to Customer by revoking auth state and deleting MFA state atomically', async () => {
    const original = staffUser();
    const updated = { ...original, role: UserRole.CUSTOMER };
    const transaction = createTransaction({
      user: {
        findUnique: jest.fn().mockResolvedValue(original),
        update: jest.fn().mockResolvedValue(updated),
      },
    });
    transaction.$queryRaw.mockResolvedValue([{ id: actorId }]);
    const repository = createRepository(transaction);

    await expect(
      repository.updateRole({
        actorId,
        targetUserId: targetId,
        requestedRole: UserRole.CUSTOMER,
        requestId: 'request-id',
        request: {},
        now,
      }),
    ).resolves.toMatchObject({
      kind: 'updated',
      user: { role: UserRole.CUSTOMER, mfaStatus: 'NONE' },
    });

    expect(transaction.session.updateMany.mock.calls).toHaveLength(1);
    expect(transaction.mfaEnrollmentGrant.updateMany.mock.calls).toHaveLength(1);
    expect(transaction.mfaChallenge.deleteMany.mock.calls).toHaveLength(1);
    expect(transaction.mfaRecoveryCode.deleteMany.mock.calls).toHaveLength(1);
    expect(transaction.mfaTotpMethod.deleteMany.mock.calls).toHaveLength(1);
    expectFirstCallToMatch(transaction.securityEvent.create, {
      data: { type: 'MFA_CHANGED', userId: targetId },
    });
    expectFirstCallToMatch(transaction.auditLog.create, {
      data: { action: AuditAction.USER_ROLE_CHANGED, entityId: targetId },
    });
  });

  it('rejects Customer targets for MFA reset without revoking anything', async () => {
    const transaction = createTransaction({
      user: {
        findUnique: jest.fn().mockResolvedValue(customerUser()),
      },
    });
    const repository = createRepository(transaction);

    await expect(
      repository.resetMfa({
        actorId,
        targetUserId: targetId,
        requestId: 'request-id',
        request: {},
        now,
      }),
    ).resolves.toEqual({ kind: 'mfa-not-available' });

    expect(transaction.session.updateMany.mock.calls).toHaveLength(0);
    expect(transaction.mfaTotpMethod.deleteMany.mock.calls).toHaveLength(0);
  });
});

function createRepository(
  transaction: ReturnType<typeof createTransaction>,
): AdministrationRepository {
  const database = {
    $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  } as unknown as DatabaseService;
  return new AdministrationRepository(database);
}

function expectFirstCallToMatch(
  mock: { mock: { calls: unknown[][] } },
  expected: Record<string, unknown>,
): void {
  expect(mock.mock.calls[0]?.[0]).toMatchObject(expected);
}

function createTransaction(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: jest.fn(),
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    mfaEnrollmentGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    mfaChallenge: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    mfaRecoveryCode: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    mfaTotpMethod: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    securityEvent: { create: jest.fn().mockResolvedValue({ id: 'event-id' }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    ...overrides,
  };
}

function customerUser() {
  return {
    id: targetId,
    email: 'customer@example.com',
    fullName: 'Customer',
    phone: null,
    avatarUrl: null,
    birthDate: null,
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: now,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    mfaTotpMethod: null,
    authIdentities: [],
  };
}

function staffUser() {
  return {
    ...customerUser(),
    role: UserRole.STAFF,
    mfaTotpMethod: { status: MfaTotpStatus.ENABLED },
  };
}

function adminUser() {
  return {
    ...staffUser(),
    id: targetId,
    role: UserRole.ADMIN,
  };
}
