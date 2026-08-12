import { Prisma, ProductStatus } from '@prisma/client';

import type { DatabaseService } from '../database/database.service';
import { CartsRepository } from './carts.repository';

const userId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const otherProductId = '44444444-4444-4444-8444-444444444444';
const itemId = '55555555-5555-4555-8555-555555555555';
const otherItemId = '66666666-6666-4666-8666-666666666666';
const now = new Date('2026-08-02T00:00:00.000Z');

function cartItemRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: itemId,
    productId,
    quantity: 2,
    createdAt: now,
    updatedAt: now,
    product: {
      id: productId,
      name: 'Cotton shirt',
      slug: 'cotton-shirt',
      price: new Prisma.Decimal('199000'),
      compareAtPrice: new Prisma.Decimal('249000'),
      status: ProductStatus.ACTIVE as ProductStatus,
      deletedAt: null,
      category: { isActive: true },
      images: [
        {
          id: 'image-id',
          url: 'https://cdn.example.com/cotton-shirt.webp',
          altText: 'Cotton shirt',
          sortOrder: 0,
          isPrimary: true,
        },
      ],
    },
    ...overrides,
  };
}

describe(CartsRepository.name, () => {
  it('builds a cart view from current server product prices without exposing inventory or storage keys', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: cartId,
      updatedAt: now,
      items: [cartItemRecord()],
    });
    const repository = new CartsRepository({
      cart: { findUnique },
    } as unknown as DatabaseService);

    const result = await repository.findForUser(userId);

    expect(result).toEqual({
      id: cartId,
      items: [
        {
          id: itemId,
          quantity: 2,
          lineTotal: '398000.00',
          product: {
            id: productId,
            name: 'Cotton shirt',
            slug: 'cotton-shirt',
            price: '199000.00',
            compareAtPrice: '249000.00',
            primaryImage: {
              id: 'image-id',
              url: 'https://cdn.example.com/cotton-shirt.webp',
              altText: 'Cotton shirt',
              sortOrder: 0,
              isPrimary: true,
            },
            isPurchasable: true,
          },
          createdAt: now,
          updatedAt: now,
        },
      ],
      itemCount: 2,
      subtotal: '398000.00',
      updatedAt: now,
    });
    expect(result?.items[0]?.product).not.toHaveProperty('inventory');
    expect(result?.items[0]?.product).not.toHaveProperty('storageKey');
  });

  it('rejects a hidden product before a cart is created', async () => {
    const transaction = {
      product: { findFirst: jest.fn().mockResolvedValue(null) },
      cart: { upsert: jest.fn() },
      cartItem: { upsert: jest.fn() },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new CartsRepository(database);

    await expect(
      repository.addItem({
        userId,
        dto: { productId, quantity: 1 },
        now,
      }),
    ).resolves.toEqual({ kind: 'product-not-found' });

    expect(transaction.cart.upsert.mock.calls).toHaveLength(0);
    expect(transaction.cartItem.upsert.mock.calls).toHaveLength(0);
    expect(transaction.product.findFirst).toHaveBeenCalledWith({
      where: {
        id: productId,
        status: ProductStatus.ACTIVE,
        deletedAt: null,
        category: { is: { isActive: true } },
      },
      select: { id: true },
    });
  });

  it('keeps an unavailable historical cart item removable while marking it not purchasable', async () => {
    const unavailableItem = cartItemRecord();
    unavailableItem.product = {
      ...unavailableItem.product,
      status: ProductStatus.ARCHIVED,
    };
    const repository = new CartsRepository({
      cart: {
        findUnique: jest.fn().mockResolvedValue({
          id: cartId,
          updatedAt: now,
          items: [unavailableItem],
        }),
      },
    } as unknown as DatabaseService);

    await expect(repository.findForUser(userId)).resolves.toMatchObject({
      items: [{ product: { isPurchasable: false } }],
    });
  });

  it('locks a lazily created cart, atomically increments a duplicate product, and touches the parent cart', async () => {
    const item = cartItemRecord({ quantity: 3 });
    const transaction = {
      product: { findFirst: jest.fn().mockResolvedValue({ id: productId }) },
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: cartId }),
        update: jest.fn().mockResolvedValue({ id: cartId }),
      },
      cartItem: { upsert: jest.fn().mockResolvedValue(item) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: cartId }]),
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new CartsRepository(database);

    await expect(
      repository.addItem({ userId, dto: { productId, quantity: 2 }, now }),
    ).resolves.toMatchObject({
      kind: 'updated',
      item: { id: itemId, quantity: 3, lineTotal: '597000.00' },
    });

    expectFirstCallToMatch(transaction.cartItem.upsert, {
      where: { cartId_productId: { cartId, productId } },
      create: { cartId, productId, quantity: 2 },
      update: { quantity: { increment: 2 } },
    });
    expectFirstCallToMatch(transaction.cart.update, {
      where: { id: cartId },
      data: { updatedAt: now },
    });
  });

  it('treats a cart item outside the current user cart as not found without mutating it', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      cartItem: { updateMany: jest.fn(), findUnique: jest.fn() },
      cart: { update: jest.fn() },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new CartsRepository(database);

    await expect(
      repository.updateItem({ userId, itemId, dto: { quantity: 1 }, now }),
    ).resolves.toEqual({ kind: 'item-not-found' });

    expect(transaction.cartItem.updateMany.mock.calls).toHaveLength(0);
  });

  it('uses the caller transaction to decrement or delete only the checked-out cart lines', async () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: cartId }])
        .mockResolvedValueOnce([
          { id: itemId, productId, quantity: 3 },
          { id: otherItemId, productId: otherProductId, quantity: 1 },
        ]),
      cartItem: {
        update: jest.fn().mockResolvedValue({ id: itemId }),
        delete: jest.fn().mockResolvedValue({ id: otherItemId }),
      },
      cart: { update: jest.fn().mockResolvedValue({ id: cartId }) },
    };
    const repository = new CartsRepository({} as DatabaseService);

    await expect(
      repository.removeCheckedOutItems(transaction as never, {
        userId,
        lines: [
          { productId: otherProductId, quantity: 1 },
          { productId, quantity: 2 },
        ],
        now,
      }),
    ).resolves.toEqual({ kind: 'removed' });

    expectFirstCallToMatch(transaction.cartItem.update, {
      where: { id: itemId },
      data: { quantity: 1 },
    });
    expectFirstCallToMatch(transaction.cartItem.delete, {
      where: { id: otherItemId },
    });
    expectFirstCallToMatch(transaction.cart.update, {
      where: { id: cartId },
      data: { updatedAt: now },
    });
  });
});

function expectFirstCallToMatch(
  mock: { mock: { calls: unknown[][] } },
  expected: Record<string, unknown>,
): void {
  expect(mock.mock.calls[0]?.[0]).toMatchObject(expected);
}
