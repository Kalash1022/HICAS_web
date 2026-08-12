import { AuditAction, InventoryTransactionType } from '@prisma/client';

import type { DatabaseService } from '../database/database.service';
import { InventoryRepository } from './inventory.repository';

const actorId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-08-02T00:00:00.000Z');

function inventoryRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    productId,
    quantity: 10,
    reservedQuantity: 3,
    version: 2,
    updatedAt: now,
    ...overrides,
  };
}

describe(InventoryRepository.name, () => {
  it('adjusts quantity, writes an ADJUST ledger entry, and writes audit data atomically', async () => {
    const current = inventoryRecord();
    const updated = inventoryRecord({ quantity: 15, version: 3 });
    const ledgerEntry = {
      id: 'ledger-id',
      productId,
      orderId: null,
      type: InventoryTransactionType.ADJUST,
      quantityDelta: 5,
      reservedDelta: 0,
      quantityAfter: 15,
      reservedAfter: 3,
      reason: 'Supplier delivery',
      createdById: actorId,
      createdAt: now,
    };
    const transaction = {
      inventory: {
        findFirst: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(updated),
      },
      inventoryTransaction: { create: jest.fn().mockResolvedValue(ledgerEntry) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new InventoryRepository(database);

    await expect(
      repository.adjust({
        actorId,
        productId,
        dto: { quantityDelta: 5, expectedVersion: 2, reason: 'Supplier delivery' },
        request: { ipAddress: '127.0.0.1' },
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({
      kind: 'updated',
      result: {
        inventory: { quantity: 15, reservedQuantity: 3, availableQuantity: 12, version: 3 },
        transaction: { id: 'ledger-id', type: InventoryTransactionType.ADJUST },
      },
    });

    expect(transaction.inventory.updateMany).toHaveBeenCalledWith({
      where: { productId, version: 2 },
      data: { quantity: 15, version: { increment: 1 } },
    });
    expectFirstCallToMatch(transaction.inventoryTransaction.create, {
      data: {
        type: InventoryTransactionType.ADJUST,
        quantityDelta: 5,
        reservedDelta: 0,
        quantityAfter: 15,
        reservedAfter: 3,
        createdById: actorId,
      },
    });
    expectFirstCallToMatch(transaction.auditLog.create, {
      data: {
        action: AuditAction.INVENTORY_ADJUSTED,
        actorId,
        entityId: productId,
      },
    });
  });

  it('rejects an adjustment that would reduce quantity below reserved stock before mutation', async () => {
    const transaction = {
      inventory: {
        findFirst: jest.fn().mockResolvedValue(inventoryRecord()),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
      inventoryTransaction: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new InventoryRepository(database);

    await expect(
      repository.adjust({
        actorId,
        productId,
        dto: { quantityDelta: -8, expectedVersion: 2, reason: 'Correction' },
        request: {},
        requestId: 'request-id',
      }),
    ).resolves.toEqual({
      kind: 'invalid-adjustment',
      quantity: 10,
      reservedQuantity: 3,
      requestedDelta: -8,
    });

    expect(transaction.inventory.updateMany).not.toHaveBeenCalled();
    expect(transaction.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns a version conflict without a ledger or audit write when the conditional update loses a race', async () => {
    const transaction = {
      inventory: {
        findFirst: jest.fn().mockResolvedValue(inventoryRecord()),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      },
      inventoryTransaction: { create: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as DatabaseService;
    const repository = new InventoryRepository(database);

    await expect(
      repository.adjust({
        actorId,
        productId,
        dto: { quantityDelta: 5, expectedVersion: 2, reason: 'Correction' },
        request: {},
        requestId: 'request-id',
      }),
    ).resolves.toEqual({ kind: 'version-conflict', currentVersion: 2 });

    expect(transaction.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('writes each internal stock mutation and its ledger entry through the caller transaction', async () => {
    const updated = inventoryRecord({ quantity: 8, reservedQuantity: 1, version: 3 });
    const transaction = {
      inventory: { update: jest.fn().mockResolvedValue(updated) },
      inventoryTransaction: { create: jest.fn().mockResolvedValue({ id: 'ledger-id' }) },
    };
    const repository = new InventoryRepository({} as DatabaseService);

    await expect(
      repository.applyMutations(transaction as never, {
        mutations: [
          {
            productId,
            type: InventoryTransactionType.COMMIT,
            quantityDelta: -2,
            reservedDelta: -2,
            quantityAfter: 8,
            reservedAfter: 1,
          },
        ],
        context: {
          orderId: '33333333-3333-4333-8333-333333333333',
          createdById: actorId,
          reason: 'Order confirmed',
        },
      }),
    ).resolves.toEqual([
      {
        productId,
        quantity: 8,
        reservedQuantity: 1,
        availableQuantity: 7,
        version: 3,
        updatedAt: now,
      },
    ]);

    expect(transaction.inventory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId },
        data: {
          quantity: 8,
          reservedQuantity: 1,
          version: { increment: 1 },
        },
      }),
    );
    expectFirstCallToMatch(transaction.inventoryTransaction.create, {
      data: {
        productId,
        orderId: '33333333-3333-4333-8333-333333333333',
        type: InventoryTransactionType.COMMIT,
        quantityDelta: -2,
        reservedDelta: -2,
        quantityAfter: 8,
        reservedAfter: 1,
        createdById: actorId,
      },
    });
  });

  it('lists transaction history with stable descending createdAt and ID ordering', async () => {
    const transactions = [
      {
        id: 'transaction-2',
        productId,
        orderId: null,
        type: InventoryTransactionType.ADJUST,
        quantityDelta: 2,
        reservedDelta: 0,
        quantityAfter: 12,
        reservedAfter: 0,
        reason: 'Second',
        createdById: actorId,
        createdAt: now,
      },
    ];
    const findMany = jest.fn().mockResolvedValue(transactions);
    const database = {
      inventory: { findFirst: jest.fn().mockResolvedValue({ productId }) },
      inventoryTransaction: {
        findMany,
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    } as unknown as DatabaseService;
    const repository = new InventoryRepository(database);

    await expect(repository.listTransactions(productId, { page: 2, limit: 10 })).resolves.toEqual({
      kind: 'found',
      result: {
        data: transactions,
        pagination: { page: 2, limit: 10, total: 1, totalPages: 1 },
      },
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      }),
    );
  });
});

function expectFirstCallToMatch(
  mock: { mock: { calls: unknown[][] } },
  expected: Record<string, unknown>,
): void {
  expect(mock.mock.calls[0]?.[0]).toMatchObject(expected);
}
