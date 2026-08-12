import { UserRole, UserStatus } from '@prisma/client';

import { AdministrationRepository } from './administration.repository';
import { AdministrationService } from './administration.service';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.com',
  fullName: 'Admin',
  role: UserRole.ADMIN,
  sessionId: 'session-id',
};
const targetId = '22222222-2222-4222-8222-222222222222';
const user = {
  id: targetId,
  email: 'target@example.com',
  fullName: 'Target',
  avatarUrl: null,
  phone: null,
  birthDate: null,
  role: UserRole.CUSTOMER,
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date('2026-07-24T00:00:00.000Z'),
  lastLoginAt: null,
  createdAt: new Date('2026-07-24T00:00:00.000Z'),
  updatedAt: new Date('2026-07-24T00:00:00.000Z'),
  mfaStatus: 'NONE' as const,
  authProviders: [],
};

describe(AdministrationService.name, () => {
  let repository: jest.Mocked<AdministrationRepository>;
  let service: AdministrationService;

  beforeEach(() => {
    repository = {
      listUsers: jest.fn(),
      findUser: jest.fn(),
      updateStatus: jest.fn(),
      updateRole: jest.fn(),
      resetMfa: jest.fn(),
    } as unknown as jest.Mocked<AdministrationRepository>;
    service = new AdministrationService(repository);
  });

  it('forwards a status mutation with actor, request context and request id', async () => {
    repository.updateStatus.mockResolvedValue({ kind: 'updated', user, changed: true });

    await expect(
      service.updateStatus({
        actor,
        targetUserId: targetId,
        requestedStatus: UserStatus.BLOCKED,
        request: { ipAddress: '127.0.0.1', userAgent: 'Jest' },
        requestId: 'request-id',
      }),
    ).resolves.toEqual(user);

    expect(repository.updateStatus.mock.calls[0]?.[0]).toMatchObject({
      actorId: actor.id,
      targetUserId: targetId,
      requestedStatus: UserStatus.BLOCKED,
      requestId: 'request-id',
      request: { ipAddress: '127.0.0.1', userAgent: 'Jest' },
    });
  });

  it('enforces the administration role before reading users', async () => {
    const query = { page: 1, limit: 20 };

    await expect(
      Promise.resolve().then(() => service.listUsers({ ...actor, role: UserRole.STAFF }, query)),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'AUTH_FORBIDDEN' },
    });
    await expect(
      service.getUser({ ...actor, role: UserRole.CUSTOMER }, targetId),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'AUTH_FORBIDDEN' },
    });

    expect(repository.listUsers.mock.calls).toHaveLength(0);
    expect(repository.findUser.mock.calls).toHaveLength(0);
  });

  it.each([
    ['missing target', { kind: 'not-found' }, 404, 'USER_NOT_FOUND'],
    ['last active admin', { kind: 'last-active-admin' }, 409, 'LAST_ACTIVE_ADMIN_REQUIRED'],
    ['Customer MFA reset', { kind: 'mfa-not-available' }, 400, 'MFA_RESET_NOT_AVAILABLE'],
  ] as const)('maps %s to a stable application error', async (_name, result, status, code) => {
    repository.resetMfa.mockResolvedValue(result);

    await expect(
      service.resetMfa({
        actor,
        targetUserId: targetId,
        request: {},
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({ status, response: { code } });
  });

  it('rejects self-reset without reaching the repository', async () => {
    await expect(
      service.resetMfa({
        actor,
        targetUserId: actor.id,
        request: {},
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({ status: 403, response: { code: 'MFA_RESET_SELF_FORBIDDEN' } });

    expect(repository.resetMfa.mock.calls).toHaveLength(0);
  });

  it('defends the service boundary when a non-admin actor calls it directly', async () => {
    await expect(
      service.updateRole({
        actor: { ...actor, role: UserRole.STAFF },
        targetUserId: targetId,
        requestedRole: UserRole.STAFF,
        request: {},
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({ status: 403, response: { code: 'AUTH_FORBIDDEN' } });

    expect(repository.updateRole.mock.calls).toHaveLength(0);
  });
});
