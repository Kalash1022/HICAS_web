import { OrderStatus, Prisma } from '@prisma/client';

import type { DatabaseService } from '../database/database.service';
import { OrdersRepository } from './orders.repository';

const userId = '11111111-1111-4111-8111-111111111111';
const productId = '33333333-3333-4333-8333-333333333333';
const orderId = '44444444-4444-4444-8444-444444444444';
const now = new Date('2026-08-03T00:00:00.000Z');

function orderRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: orderId,
    orderNumber: 'ORD-20260803-0123456789ABCDEF',
    status: 'PENDING',
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    paidAt: null,
    subtotal: new Prisma.Decimal('199000'),
    shippingFee: new Prisma.Decimal('30000'),
    discountAmount: new Prisma.Decimal('0'),
    totalAmount: new Prisma.Decimal('229000'),
    currency: 'VND',
    shippingSnapshot: {
      recipientName: 'Nguyen Van A',
      phone: '0901234567',
      province: 'Ho Chi Minh City',
      district: 'District 1',
      ward: 'Ben Nghe Ward',
      street: '12 Nguyen Hue Street',
      postalCode: '700000',
    },
    customerNote: 'Ring the doorbell.',
    idempotencyRequestHash: 'request-hash',
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: 'item-id',
        productId,
        productName: 'Cotton shirt',
        productSku: 'SHIRT-001',
        productImageUrl: 'https://cdn.example.com/shirt.webp',
        unitPrice: new Prisma.Decimal('199000'),
        quantity: 1,
        lineTotal: new Prisma.Decimal('199000'),
      },
    ],
    ...overrides,
  };
}

describe(OrdersRepository.name, () => {
  it('maps an idempotency lookup to a safe order view without internal key/hash fields', async () => {
    const findFirst = jest.fn().mockResolvedValue(orderRecord());
    const repository = new OrdersRepository({ order: { findFirst } } as unknown as DatabaseService);

    const result = await repository.findByIdempotency(userId, 'attempt-1');

    expect(result).toMatchObject({
      idempotencyRequestHash: 'request-hash',
      order: {
        id: orderId,
        orderNumber: 'ORD-20260803-0123456789ABCDEF',
        subtotal: '199000.00',
        shippingFee: '30000.00',
        totalAmount: '229000.00',
        shippingSnapshot: { recipientName: 'Nguyen Van A' },
        items: [{ productId, unitPrice: '199000.00', lineTotal: '199000.00' }],
      },
    });
    expect(result?.order).not.toHaveProperty('idempotencyKey');
    expect(result?.order).not.toHaveProperty('idempotencyRequestHash');
    expect(firstCallArgument(findFirst)).toMatchObject({
      where: { userId, idempotencyKey: 'attempt-1' },
    });
  });

  it('re-reads only currently purchasable product data after the inventory lock', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: productId,
        name: 'Cotton shirt',
        sku: 'SHIRT-001',
        price: new Prisma.Decimal('199000'),
        images: [{ url: 'https://cdn.example.com/shirt.webp' }],
      },
    ]);
    const transaction = { product: { findMany } };
    const repository = new OrdersRepository({} as DatabaseService);

    await expect(
      repository.findPurchasableProducts(transaction as never, [productId]),
    ).resolves.toEqual([
      {
        id: productId,
        name: 'Cotton shirt',
        sku: 'SHIRT-001',
        price: new Prisma.Decimal('199000'),
        primaryImageUrl: 'https://cdn.example.com/shirt.webp',
      },
    ]);

    expect(firstCallArgument(findMany)).toMatchObject({
      where: {
        id: { in: [productId] },
        status: 'ACTIVE',
        deletedAt: null,
        category: { is: { isActive: true } },
      },
    });
  });

  it('writes immutable order, product, and address snapshots with the initial pending history', async () => {
    const record = orderRecord();
    const create = jest.fn().mockResolvedValue(record);
    const transaction = { order: { create } };
    const repository = new OrdersRepository({} as DatabaseService);

    await expect(
      repository.createPending(transaction as never, {
        orderNumber: 'ORD-20260803-0123456789ABCDEF',
        userId,
        shippingSnapshot: {
          recipientName: 'Nguyen Van A',
          phone: '0901234567',
          province: 'Ho Chi Minh City',
          district: 'District 1',
          ward: 'Ben Nghe Ward',
          street: '12 Nguyen Hue Street',
          postalCode: '700000',
        },
        customerNote: 'Ring the doorbell.',
        idempotencyKey: 'attempt-1',
        idempotencyRequestHash: 'request-hash',
        subtotal: new Prisma.Decimal('199000'),
        shippingFee: new Prisma.Decimal('30000'),
        discountAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal('229000'),
        lines: [
          {
            productId,
            quantity: 1,
            product: {
              id: productId,
              name: 'Cotton shirt',
              sku: 'SHIRT-001',
              price: new Prisma.Decimal('199000'),
              primaryImageUrl: 'https://cdn.example.com/shirt.webp',
            },
            unitPrice: new Prisma.Decimal('199000'),
            lineTotal: new Prisma.Decimal('199000'),
          },
        ],
      }),
    ).resolves.toMatchObject({ order: { id: orderId } });

    expect(firstCallArgument(create)).toMatchObject({
      data: {
        orderNumber: 'ORD-20260803-0123456789ABCDEF',
        userId,
        status: 'PENDING',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        paidAt: null,
        currency: 'VND',
        shippingSnapshot: {
          recipientName: 'Nguyen Van A',
          postalCode: '700000',
        },
        items: {
          create: [
            {
              productId,
              productName: 'Cotton shirt',
              productSku: 'SHIRT-001',
              productImageUrl: 'https://cdn.example.com/shirt.webp',
              quantity: 1,
            },
          ],
        },
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: 'PENDING',
            changedById: userId,
            note: null,
          },
        },
      },
    });
  });

  it('takes a transaction-scoped lock before checking the same user idempotency key', async () => {
    const transaction = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const repository = new OrdersRepository({} as DatabaseService);

    await repository.lockIdempotencyKey(transaction as never, userId, 'attempt-1');

    expect(transaction.$queryRaw.mock.calls).toHaveLength(1);
  });

  it('lists customer orders with an ownership predicate and stable newest-first pagination', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const database = {
      order: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    } as unknown as DatabaseService;
    const repository = new OrdersRepository(database);

    await expect(
      repository.listForUser(userId, { page: 1, limit: 20, status: OrderStatus.PENDING }),
    ).resolves.toEqual({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });

    expect(firstCallArgument(findMany)).toMatchObject({
      where: { userId, status: OrderStatus.PENDING },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    });
    expect(firstCallArgument(count)).toMatchObject({
      where: { userId, status: OrderStatus.PENDING },
    });
  });

  it('writes COD completion payment fields, history, and a compact status audit atomically', async () => {
    const completed = orderRecord({
      status: OrderStatus.COMPLETED,
      paymentStatus: 'PAID',
      paidAt: now,
    });
    const transaction = {
      order: { update: jest.fn().mockResolvedValue(completed) },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({ id: 'history-id' }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    };
    const repository = new OrdersRepository({} as DatabaseService);

    await expect(
      repository.applyTransition(transaction as never, {
        orderId,
        fromStatus: OrderStatus.SHIPPING,
        fromPaymentStatus: 'UNPAID',
        fromPaidAt: null,
        toStatus: OrderStatus.COMPLETED,
        actorId: userId,
        note: null,
        request: { ipAddress: '127.0.0.1' },
        requestId: 'request-id',
        now,
      }),
    ).resolves.toMatchObject({
      status: OrderStatus.COMPLETED,
      paymentStatus: 'PAID',
      paidAt: now,
    });

    expect(firstCallArgument(transaction.order.update)).toMatchObject({
      where: { id: orderId },
      data: {
        status: OrderStatus.COMPLETED,
        paymentStatus: 'PAID',
        paidAt: now,
      },
    });
    expect(firstCallArgument(transaction.orderStatusHistory.create)).toMatchObject({
      data: {
        orderId,
        fromStatus: OrderStatus.SHIPPING,
        toStatus: OrderStatus.COMPLETED,
        changedById: userId,
        note: null,
      },
    });
    expect(firstCallArgument(transaction.auditLog.create)).toMatchObject({
      data: {
        actorId: userId,
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'ORDER',
        entityId: orderId,
        beforeData: {
          status: OrderStatus.SHIPPING,
          paymentStatus: 'UNPAID',
          paidAt: null,
        },
        afterData: {
          status: OrderStatus.COMPLETED,
          paymentStatus: 'PAID',
          paidAt: now.toISOString(),
        },
        ipAddress: '127.0.0.1',
        requestId: 'request-id',
      },
    });
  });
});

function firstCallArgument(mock: { mock: { calls: unknown[][] } }): unknown {
  return mock.mock.calls[0]?.[0];
}
