import { UserRole } from '@prisma/client';

import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.com',
  fullName: 'Admin',
  role: UserRole.ADMIN,
  sessionId: 'session-id',
};

describe(AuditService.name, () => {
  let repository: jest.Mocked<AuditRepository>;
  let service: AuditService;

  beforeEach(() => {
    repository = { list: jest.fn() } as unknown as jest.Mocked<AuditRepository>;
    service = new AuditService(repository);
  });

  it('allows Administrators to list audit logs', async () => {
    const query = { page: 1, limit: 20 };
    const expected = {
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    };
    repository.list.mockResolvedValue(expected);

    await expect(service.listAuditLogs(actor, query)).resolves.toEqual(expected);
    expect(repository.list.mock.calls[0]?.[0]).toEqual(query);
  });

  it.each([UserRole.CUSTOMER, UserRole.STAFF])(
    'rejects %s before reaching the audit repository',
    async (role) => {
      await expect(
        Promise.resolve().then(() =>
          service.listAuditLogs({ ...actor, role }, { page: 1, limit: 20 }),
        ),
      ).rejects.toMatchObject({ status: 403, response: { code: 'AUTH_FORBIDDEN' } });

      expect(repository.list.mock.calls).toHaveLength(0);
    },
  );
});
