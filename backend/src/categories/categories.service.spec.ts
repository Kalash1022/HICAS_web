import { UserRole } from '@prisma/client';

import { CategoriesRepository } from './categories.repository';
import { CategoriesService } from './categories.service';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'staff@example.com',
  fullName: 'Staff',
  role: UserRole.STAFF,
  sessionId: 'session-id',
};

describe(CategoriesService.name, () => {
  let repository: jest.Mocked<CategoriesRepository>;
  let service: CategoriesService;

  beforeEach(() => {
    repository = {
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<CategoriesRepository>;
    service = new CategoriesService(repository);
  });

  it('allows Staff to list categories but rejects customers at the service boundary', async () => {
    repository.list.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });

    await expect(service.list(actor, { page: 1, limit: 20 })).resolves.toMatchObject({ data: [] });
    await expect(
      Promise.resolve().then(() =>
        service.list({ ...actor, role: UserRole.CUSTOMER }, { page: 1, limit: 20 }),
      ),
    ).rejects.toMatchObject({ status: 403, response: { code: 'AUTH_FORBIDDEN' } });
  });

  it('maps a non-empty category deletion to the stable conflict code', async () => {
    repository.delete.mockResolvedValue({ kind: 'not-empty' });

    await expect(
      service.delete(actor, '22222222-2222-4222-8222-222222222222'),
    ).rejects.toMatchObject({ status: 409, response: { code: 'CATEGORY_NOT_EMPTY' } });
  });
});
