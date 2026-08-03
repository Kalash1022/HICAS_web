import { UserRole } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { DatabaseService } from '../database/database.service';
import { CartsRepository } from './carts.repository';
import { CartService } from './carts.service';

const userId = '11111111-1111-4111-8111-111111111111';
const productA = '22222222-2222-4222-8222-222222222222';
const productB = '33333333-3333-4333-8333-333333333333';
const actor: AuthenticatedUser = {
  id: userId,
  email: 'customer@example.com',
  fullName: 'Customer',
  role: UserRole.CUSTOMER,
  sessionId: 'session-id',
};

describe(CartService.name, () => {
  let repository: jest.Mocked<CartsRepository>;
  let service: CartService;

  beforeEach(() => {
    repository = {
      findForUser: jest.fn(),
      addItem: jest.fn(),
      updateItem: jest.fn(),
      deleteItem: jest.fn(),
      removeCheckedOutItems: jest.fn(),
    } as unknown as jest.Mocked<CartsRepository>;
    service = new CartService(repository);
  });

  it('returns a stable empty cart without creating a row for a user who has no cart yet', async () => {
    repository.findForUser.mockResolvedValue(null);

    await expect(service.get(actor)).resolves.toEqual({
      id: null,
      items: [],
      itemCount: 0,
      subtotal: '0.00',
      updatedAt: null,
    });
    expect(repository.findForUser.mock.calls).toEqual([[userId]]);
  });

  it('uses the authenticated user as the ownership boundary for item mutations', async () => {
    repository.updateItem.mockResolvedValue({ kind: 'item-not-found' });

    await expect(
      service.update({
        actor,
        itemId: '44444444-4444-4444-8444-444444444444',
        dto: { quantity: 2 },
      }),
    ).rejects.toMatchObject({ status: 404, response: { code: 'CART_ITEM_NOT_FOUND' } });

    expect(repository.updateItem.mock.calls[0]?.[0]).toMatchObject({
      userId,
      itemId: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('does not allow a non-public product to be added to a cart', async () => {
    repository.addItem.mockResolvedValue({ kind: 'product-not-found' });

    await expect(
      service.add({ actor, dto: { productId: productA, quantity: 1 } }),
    ).rejects.toMatchObject({ status: 404, response: { code: 'PRODUCT_NOT_FOUND' } });
  });

  it('aggregates checkout lines in product-ID order before using the caller transaction', async () => {
    const transaction = {} as DatabaseService;
    repository.removeCheckedOutItems.mockResolvedValue({ kind: 'removed' });

    await service.removeCheckedOutItems(transaction, {
      userId,
      now: new Date('2026-08-02T00:00:00.000Z'),
      lines: [
        { productId: productB, quantity: 1 },
        { productId: productA, quantity: 2 },
        { productId: productB, quantity: 3 },
      ],
    });

    expect(repository.removeCheckedOutItems.mock.calls[0]?.[0]).toBe(transaction);
    expect(repository.removeCheckedOutItems.mock.calls[0]?.[1]).toMatchObject({
      userId,
      now: new Date('2026-08-02T00:00:00.000Z'),
      lines: [
        { productId: productA, quantity: 2 },
        { productId: productB, quantity: 4 },
      ],
    });
  });

  it('maps a checkout quantity race to a stable conflict response', async () => {
    const transaction = {} as DatabaseService;
    repository.removeCheckedOutItems.mockResolvedValue({
      kind: 'insufficient-quantity',
      productId: productA,
      quantity: 1,
      requestedQuantity: 2,
    });

    await expect(
      service.removeCheckedOutItems(transaction, {
        userId,
        lines: [{ productId: productA, quantity: 2 }],
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'CART_ITEM_QUANTITY_CONFLICT',
        details: { productId: productA, quantity: 1, requestedQuantity: 2 },
      },
    });
  });
});
