import { InventoryTransactionType, UserRole } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { DatabaseService } from '../database/database.service';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';

const productA = '11111111-1111-4111-8111-111111111111';
const productB = '22222222-2222-4222-8222-222222222222';
const actor: AuthenticatedUser = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'staff@example.com',
  fullName: 'Staff',
  role: UserRole.STAFF,
  sessionId: 'session-id',
};

describe(InventoryService.name, () => {
  let repository: jest.Mocked<InventoryRepository>;
  let service: InventoryService;

  beforeEach(() => {
    repository = {
      listTransactions: jest.fn(),
      adjust: jest.fn(),
      lockForProducts: jest.fn(),
      applyMutations: jest.fn(),
    } as unknown as jest.Mocked<InventoryRepository>;
    service = new InventoryService(repository);
  });

  it('protects inventory administration at the service boundary', async () => {
    await expect(
      Promise.resolve().then(() =>
        service.listTransactions({ ...actor, role: UserRole.CUSTOMER }, productA, {
          page: 1,
          limit: 20,
        }),
      ),
    ).rejects.toMatchObject({ status: 403, response: { code: 'AUTH_FORBIDDEN' } });

    expect(repository.listTransactions.mock.calls).toHaveLength(0);
  });

  it('maps a stale admin adjustment to a stable version conflict', async () => {
    repository.adjust.mockResolvedValue({ kind: 'version-conflict', currentVersion: 5 });

    await expect(
      service.adjust({
        actor,
        productId: productA,
        dto: { quantityDelta: 5, expectedVersion: 4, reason: 'Delivery' },
        request: {},
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'INVENTORY_VERSION_CONFLICT',
        details: { expectedVersion: 4, currentVersion: 5 },
      },
    });
  });

  it('deduplicates lines, locks product IDs in stable order, and records RESERVE deltas', async () => {
    const transaction = {} as DatabaseService;
    repository.lockForProducts.mockResolvedValue([
      { productId: productA, quantity: 10, reservedQuantity: 2, version: 3 },
      { productId: productB, quantity: 5, reservedQuantity: 0, version: 1 },
    ]);
    repository.applyMutations.mockResolvedValue([]);

    await service.reserve(
      transaction,
      [
        { productId: productB, quantity: 1 },
        { productId: productA, quantity: 2 },
        { productId: productB, quantity: 3 },
      ],
      { orderId: '44444444-4444-4444-8444-444444444444', reason: 'Checkout reservation' },
    );

    expect(repository.lockForProducts.mock.calls).toEqual([[transaction, [productA, productB]]]);
    expect(repository.applyMutations.mock.calls).toEqual([
      [
        transaction,
        {
          mutations: [
            {
              productId: productA,
              type: InventoryTransactionType.RESERVE,
              quantityDelta: 0,
              reservedDelta: 2,
              quantityAfter: 10,
              reservedAfter: 4,
            },
            {
              productId: productB,
              type: InventoryTransactionType.RESERVE,
              quantityDelta: 0,
              reservedDelta: 4,
              quantityAfter: 5,
              reservedAfter: 4,
            },
          ],
          context: {
            orderId: '44444444-4444-4444-8444-444444444444',
            reason: 'Checkout reservation',
          },
        },
      ],
    ]);
  });

  it('reports missing inventory rows after a stable lock attempt', async () => {
    const transaction = {} as DatabaseService;
    repository.lockForProducts.mockResolvedValue([
      { productId: productA, quantity: 10, reservedQuantity: 0, version: 0 },
    ]);

    await expect(
      service.lockForProducts(transaction, [productB, productA, productB]),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'INVENTORY_NOT_FOUND',
        details: { productIds: [productB] },
      },
    });

    expect(repository.lockForProducts.mock.calls).toEqual([[transaction, [productA, productB]]]);
  });

  it.each([
    {
      name: 'release',
      execute: (target: InventoryService, transaction: DatabaseService) =>
        target.release(transaction, [{ productId: productA, quantity: 2 }], {
          reason: 'Pending cancel',
        }),
      expected: { quantityDelta: 0, reservedDelta: -2, quantityAfter: 10, reservedAfter: 3 },
    },
    {
      name: 'commit',
      execute: (target: InventoryService, transaction: DatabaseService) =>
        target.commit(transaction, [{ productId: productA, quantity: 2 }], {
          reason: 'Order confirmed',
        }),
      expected: { quantityDelta: -2, reservedDelta: -2, quantityAfter: 8, reservedAfter: 3 },
    },
    {
      name: 'restock',
      execute: (target: InventoryService, transaction: DatabaseService) =>
        target.restock(transaction, [{ productId: productA, quantity: 2 }], {
          reason: 'Order cancelled',
        }),
      expected: { quantityDelta: 2, reservedDelta: 0, quantityAfter: 12, reservedAfter: 5 },
    },
  ])(
    'calculates $name ledger deltas without violating stock invariants',
    async ({ execute, expected }) => {
      const transaction = {} as DatabaseService;
      repository.lockForProducts.mockResolvedValue([
        { productId: productA, quantity: 10, reservedQuantity: 5, version: 3 },
      ]);
      repository.applyMutations.mockResolvedValue([]);

      await execute(service, transaction);

      expect(repository.applyMutations.mock.calls[0]?.[0]).toBe(transaction);
      expect(repository.applyMutations.mock.calls[0]?.[1]).toMatchObject({
        mutations: [
          {
            productId: productA,
            ...expected,
          },
        ],
      });
    },
  );

  it('rejects a reservation when available stock is insufficient before writing a ledger entry', async () => {
    const transaction = {} as DatabaseService;
    repository.lockForProducts.mockResolvedValue([
      { productId: productA, quantity: 3, reservedQuantity: 2, version: 1 },
    ]);

    await expect(
      service.reserve(transaction, [{ productId: productA, quantity: 2 }], {
        reason: 'Checkout reservation',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'PRODUCT_OUT_OF_STOCK', details: { productId: productA, available: 1 } },
    });

    expect(repository.applyMutations.mock.calls).toHaveLength(0);
  });
});
