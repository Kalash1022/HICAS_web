import { ProductStatus, UserRole } from '@prisma/client';

import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'staff@example.com',
  fullName: 'Staff',
  role: UserRole.STAFF,
  sessionId: 'session-id',
};

describe(ProductsService.name, () => {
  let repository: jest.Mocked<ProductsRepository>;
  let service: ProductsService;

  beforeEach(() => {
    repository = {
      list: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<ProductsRepository>;
    service = new ProductsService(repository);
  });

  it('protects product reads at the service boundary', async () => {
    await expect(
      Promise.resolve().then(() =>
        service.list({ ...actor, role: UserRole.CUSTOMER }, { page: 1, limit: 20 }),
      ),
    ).rejects.toMatchObject({ status: 403, response: { code: 'AUTH_FORBIDDEN' } });

    expect(repository.list.mock.calls).toHaveLength(0);
  });

  it('maps activation requirements to a stable conflict response', async () => {
    repository.update.mockResolvedValue({
      kind: 'cannot-activate',
      reasons: ['IMAGE_REQUIRED'],
    });

    await expect(
      service.update({
        actor,
        productId: '22222222-2222-4222-8222-222222222222',
        dto: { status: ProductStatus.ACTIVE },
        request: {},
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'PRODUCT_CANNOT_ACTIVATE',
        details: { reasons: ['IMAGE_REQUIRED'] },
      },
    });
  });
});
