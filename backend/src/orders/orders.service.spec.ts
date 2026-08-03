import { OrderStatus, Prisma, UserRole } from '@prisma/client';

import type { AddressesService } from '../addresses/addresses.service';
import type { CartService } from '../carts/carts.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { DatabaseService } from '../database/database.service';
import type { InventoryService } from '../inventory/inventory.service';
import { prepareCheckoutRequest } from './checkout-idempotency';
import { CheckoutRateLimiterService } from './checkout-rate-limiter.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import type { CheckoutProduct, LockedOrder, StoredOrder } from './orders.types';

const userId = '11111111-1111-4111-8111-111111111111';
const addressId = '22222222-2222-4222-8222-222222222222';
const productA = '33333333-3333-4333-8333-333333333333';
const productB = '44444444-4444-4444-8444-444444444444';
const orderId = '55555555-5555-4555-8555-555555555555';
const now = new Date('2026-08-03T00:00:00.000Z');
const actor: AuthenticatedUser = {
  id: userId,
  email: 'customer@example.com',
  fullName: 'Customer',
  role: UserRole.CUSTOMER,
  sessionId: 'session-id',
};
const shippingSnapshot = {
  recipientName: 'Nguyen Van A',
  phone: '0901234567',
  province: 'Ho Chi Minh City',
  district: 'District 1',
  ward: 'Ben Nghe Ward',
  street: '12 Nguyen Hue Street',
  postalCode: '700000',
};

function checkoutDto(overrides: Partial<CreateOrderDto> = {}): CreateOrderDto {
  return {
    addressId,
    items: [
      { productId: productB, quantity: 1 },
      { productId: productA, quantity: 2 },
    ],
    customerNote: '  Ring the doorbell.  ',
    ...overrides,
  };
}

function product(id: string, price: string): CheckoutProduct {
  return {
    id,
    name: id === productA ? 'Cotton shirt' : 'Canvas bag',
    sku: id === productA ? 'SHIRT-001' : 'BAG-001',
    price: new Prisma.Decimal(price),
    primaryImageUrl: `https://cdn.example.com/${id}.webp`,
  };
}

function storedOrder(overrides: Partial<StoredOrder> = {}): StoredOrder {
  return {
    idempotencyRequestHash: 'request-hash',
    order: {
      id: orderId,
      orderNumber: 'ORD-20260803-0123456789ABCDEF',
      status: 'PENDING',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      paidAt: null,
      subtotal: '598000.00',
      shippingFee: '30000.00',
      discountAmount: '0.00',
      totalAmount: '628000.00',
      currency: 'VND',
      shippingSnapshot,
      customerNote: 'Ring the doorbell.',
      items: [],
      createdAt: now,
      updatedAt: now,
    },
    ...overrides,
  };
}

function lockedOrder(status: OrderStatus): LockedOrder {
  return {
    id: orderId,
    status,
    paymentStatus: 'UNPAID',
    paidAt: null,
  };
}

describe(OrdersService.name, () => {
  let database: { $transaction: jest.Mock };
  let repository: jest.Mocked<OrdersRepository>;
  let addresses: jest.Mocked<AddressesService>;
  let inventory: jest.Mocked<InventoryService>;
  let carts: jest.Mocked<CartService>;
  let config: { getOrThrow: jest.Mock };
  let checkoutRateLimiter: jest.Mocked<CheckoutRateLimiterService>;
  let service: OrdersService;
  let transaction: Record<string, never>;

  beforeEach(() => {
    transaction = {};
    database = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    repository = {
      findByIdempotency: jest.fn(),
      findByIdempotencyInTransaction: jest.fn(),
      lockIdempotencyKey: jest.fn(),
      findPurchasableProducts: jest.fn(),
      createPending: jest.fn(),
      listForUser: jest.fn(),
      listForAdmin: jest.fn(),
      findForUser: jest.fn(),
      findForAdmin: jest.fn(),
      lockOwnedByOrderNumber: jest.fn(),
      lockById: jest.fn(),
      findInventoryLines: jest.fn(),
      applyTransition: jest.fn(),
    } as unknown as jest.Mocked<OrdersRepository>;
    addresses = {
      getOwnedShippingSnapshot: jest.fn(),
    } as unknown as jest.Mocked<AddressesService>;
    inventory = {
      lockForProducts: jest.fn(),
      reserve: jest.fn(),
      release: jest.fn(),
      commit: jest.fn(),
      restock: jest.fn(),
    } as unknown as jest.Mocked<InventoryService>;
    carts = {
      removeCheckedOutItems: jest.fn(),
    } as unknown as jest.Mocked<CartService>;
    config = { getOrThrow: jest.fn().mockReturnValue(30_000) };
    checkoutRateLimiter = {
      consume: jest.fn(),
    } as unknown as jest.Mocked<CheckoutRateLimiterService>;
    service = new OrdersService(
      database as unknown as DatabaseService,
      repository,
      addresses,
      inventory,
      carts,
      config as never,
      checkoutRateLimiter,
    );
  });

  it('coordinates one COD checkout transaction with server prices, snapshots, reservation, and cart removal', async () => {
    const created = storedOrder();
    repository.findByIdempotency.mockResolvedValue(null);
    repository.findByIdempotencyInTransaction.mockResolvedValue(null);
    repository.lockIdempotencyKey.mockResolvedValue();
    repository.findPurchasableProducts.mockResolvedValue([
      product(productA, '199000'),
      product(productB, '200000'),
    ]);
    repository.createPending.mockResolvedValue(created);
    addresses.getOwnedShippingSnapshot.mockResolvedValue(shippingSnapshot);
    inventory.lockForProducts.mockResolvedValue([
      { productId: productA, quantity: 10, reservedQuantity: 2, version: 1 },
      { productId: productB, quantity: 10, reservedQuantity: 0, version: 1 },
    ]);
    inventory.reserve.mockResolvedValue([]);
    carts.removeCheckedOutItems.mockResolvedValue();

    await expect(
      service.checkout({
        actor,
        dto: checkoutDto(),
        idempotencyKey: 'attempt-1',
        request: { ipAddress: '127.0.0.1' },
      }),
    ).resolves.toEqual({ order: created.order, replayed: false });

    expect(checkoutRateLimiter.consume.mock.calls).toEqual([[userId, '127.0.0.1']]);
    expect(repository.lockIdempotencyKey.mock.calls).toEqual([[transaction, userId, 'attempt-1']]);
    expect(repository.findByIdempotencyInTransaction.mock.calls).toEqual([
      [transaction, userId, 'attempt-1'],
    ]);
    expect(addresses.getOwnedShippingSnapshot.mock.calls).toEqual([
      [transaction, userId, addressId],
    ]);
    expect(inventory.lockForProducts.mock.calls).toEqual([[transaction, [productA, productB]]]);
    expect(repository.findPurchasableProducts.mock.calls).toEqual([
      [transaction, [productA, productB]],
    ]);
    expectCallArgumentToMatch(repository.createPending.mock, 1, {
      userId,
      shippingSnapshot,
      customerNote: 'Ring the doorbell.',
      idempotencyKey: 'attempt-1',
      subtotal: expectDecimal('598000'),
      shippingFee: expectDecimal('30000'),
      discountAmount: expectDecimal('0'),
      totalAmount: expectDecimal('628000'),
      lines: [
        {
          productId: productA,
          quantity: 2,
          unitPrice: expectDecimal('199000'),
          lineTotal: expectDecimal('398000'),
        },
        {
          productId: productB,
          quantity: 1,
          unitPrice: expectDecimal('200000'),
          lineTotal: expectDecimal('200000'),
        },
      ],
    });
    expect(repository.createPending.mock.calls[0]?.[1].orderNumber).toMatch(
      /^ORD-\d{8}-[A-F0-9]{16}$/,
    );
    expect(inventory.reserve.mock.calls).toEqual([
      [
        transaction,
        [
          { productId: productA, quantity: 2 },
          { productId: productB, quantity: 1 },
        ],
        {
          orderId,
          createdById: userId,
          reason: 'Checkout reservation',
        },
      ],
    ]);
    expect(carts.removeCheckedOutItems.mock.calls[0]?.[0]).toBe(transaction);
    expect(carts.removeCheckedOutItems.mock.calls[0]?.[1]).toMatchObject({
      userId,
      lines: [
        { productId: productA, quantity: 2 },
        { productId: productB, quantity: 1 },
      ],
    });
  });

  it('replays an existing order before opening a checkout transaction', async () => {
    const dto = checkoutDto();
    const canonicalHash = prepareCheckoutRequest(dto, 'attempt-2').requestHash;
    const existing = storedOrder({ idempotencyRequestHash: canonicalHash });
    repository.findByIdempotency.mockResolvedValue(existing);

    await expect(
      service.checkout({ actor, dto, idempotencyKey: 'attempt-2', request: {} }),
    ).resolves.toEqual({ order: existing.order, replayed: true });

    expect(database.$transaction.mock.calls).toHaveLength(0);
    expect(inventory.reserve.mock.calls).toHaveLength(0);
    expect(carts.removeCheckedOutItems.mock.calls).toHaveLength(0);
  });

  it('rejects reusing an idempotency key with a different canonical request', async () => {
    repository.findByIdempotency.mockResolvedValue(
      storedOrder({ idempotencyRequestHash: 'different' }),
    );

    await expect(
      service.checkout({
        actor,
        dto: checkoutDto(),
        idempotencyKey: 'attempt-3',
        request: {},
      }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });

    expect(database.$transaction.mock.calls).toHaveLength(0);
  });

  it('rejects an unpublished product after the stock lock without creating an order', async () => {
    repository.findByIdempotency.mockResolvedValue(null);
    repository.findByIdempotencyInTransaction.mockResolvedValue(null);
    repository.lockIdempotencyKey.mockResolvedValue();
    addresses.getOwnedShippingSnapshot.mockResolvedValue(shippingSnapshot);
    inventory.lockForProducts.mockResolvedValue([
      { productId: productA, quantity: 10, reservedQuantity: 0, version: 1 },
      { productId: productB, quantity: 10, reservedQuantity: 0, version: 1 },
    ]);
    repository.findPurchasableProducts.mockResolvedValue([product(productA, '199000')]);

    await expect(
      service.checkout({ actor, dto: checkoutDto(), idempotencyKey: 'attempt-4', request: {} }),
    ).rejects.toMatchObject({ status: 404, response: { code: 'PRODUCT_NOT_FOUND' } });

    expect(repository.createPending.mock.calls).toHaveLength(0);
    expect(inventory.reserve.mock.calls).toHaveLength(0);
  });

  it('rejects insufficient available stock before creating the order', async () => {
    repository.findByIdempotency.mockResolvedValue(null);
    repository.findByIdempotencyInTransaction.mockResolvedValue(null);
    repository.lockIdempotencyKey.mockResolvedValue();
    addresses.getOwnedShippingSnapshot.mockResolvedValue(shippingSnapshot);
    inventory.lockForProducts.mockResolvedValue([
      { productId: productA, quantity: 3, reservedQuantity: 2, version: 1 },
      { productId: productB, quantity: 10, reservedQuantity: 0, version: 1 },
    ]);
    repository.findPurchasableProducts.mockResolvedValue([
      product(productA, '199000'),
      product(productB, '200000'),
    ]);

    await expect(
      service.checkout({ actor, dto: checkoutDto(), idempotencyKey: 'attempt-5', request: {} }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'PRODUCT_OUT_OF_STOCK', details: { productId: productA, available: 1 } },
    });

    expect(repository.createPending.mock.calls).toHaveLength(0);
    expect(inventory.reserve.mock.calls).toHaveLength(0);
  });

  it('recovers an idempotency unique race by returning the order created by the winner', async () => {
    const dto = checkoutDto();
    const canonicalHash = prepareCheckoutRequest(dto, 'attempt-6').requestHash;
    const racedOrder = storedOrder({ idempotencyRequestHash: canonicalHash });
    const uniqueError = new Prisma.PrismaClientKnownRequestError(
      'duplicate order idempotency key',
      {
        code: 'P2002',
        clientVersion: '6.19.0',
        meta: { target: 'orders_user_id_idempotency_key_key' },
      },
    );
    repository.findByIdempotency.mockResolvedValueOnce(null).mockResolvedValueOnce(racedOrder);
    database.$transaction.mockRejectedValue(uniqueError);

    await expect(
      service.checkout({ actor, dto, idempotencyKey: 'attempt-6', request: {} }),
    ).resolves.toEqual({ order: racedOrder.order, replayed: true });
  });

  it('releases reservation when the current user cancels a pending order', async () => {
    const updated = storedOrder().order;
    repository.lockOwnedByOrderNumber.mockResolvedValue(lockedOrder(OrderStatus.PENDING));
    repository.findInventoryLines.mockResolvedValue([{ productId: productB, quantity: 1 }]);
    repository.applyTransition.mockResolvedValue(updated);
    inventory.release.mockResolvedValue([]);

    await expect(
      service.cancelOwn({
        actor,
        orderNumber: updated.orderNumber,
        dto: {},
        request: { ipAddress: '127.0.0.1' },
        requestId: 'request-id',
      }),
    ).resolves.toEqual(updated);

    expect(repository.lockOwnedByOrderNumber.mock.calls).toEqual([
      [transaction, userId, updated.orderNumber],
    ]);
    expect(inventory.release.mock.calls).toEqual([
      [
        transaction,
        [{ productId: productB, quantity: 1 }],
        {
          orderId,
          createdById: userId,
          reason: 'Order cancelled by customer',
        },
      ],
    ]);
    expectCallArgumentToMatch(repository.applyTransition.mock, 1, {
      orderId,
      fromStatus: OrderStatus.PENDING,
      toStatus: OrderStatus.CANCELLED,
      actorId: userId,
      note: null,
      requestId: 'request-id',
    });
  });

  it('commits stock before Staff confirms a pending order', async () => {
    const staff = { ...actor, role: UserRole.STAFF };
    const updated = storedOrder().order;
    repository.lockById.mockResolvedValue(lockedOrder(OrderStatus.PENDING));
    repository.findInventoryLines.mockResolvedValue([
      { productId: productB, quantity: 1 },
      { productId: productA, quantity: 2 },
    ]);
    repository.applyTransition.mockResolvedValue(updated);
    inventory.commit.mockResolvedValue([]);

    await expect(
      service.updateStatus({
        actor: staff,
        orderId,
        dto: { status: OrderStatus.CONFIRMED },
        request: {},
        requestId: 'request-id',
      }),
    ).resolves.toEqual(updated);

    expect(inventory.commit.mock.calls).toEqual([
      [
        transaction,
        [
          { productId: productA, quantity: 2 },
          { productId: productB, quantity: 1 },
        ],
        {
          orderId,
          createdById: userId,
          reason: 'Order confirmed',
        },
      ],
    ]);
    expect(repository.lockById.mock.invocationCallOrder[0]).toBeLessThan(
      inventory.commit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(inventory.commit.mock.invocationCallOrder[0]).toBeLessThan(
      repository.applyTransition.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('requires a nonblank reason before Staff restocks a confirmed order cancellation', async () => {
    const staff = { ...actor, role: UserRole.STAFF };
    repository.lockById.mockResolvedValue(lockedOrder(OrderStatus.CONFIRMED));

    await expect(
      service.updateStatus({
        actor: staff,
        orderId,
        dto: { status: OrderStatus.CANCELLED, note: '   ' },
        request: {},
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'ORDER_CANCELLATION_REASON_REQUIRED' },
    });

    expect(repository.findInventoryLines.mock.calls).toHaveLength(0);
    expect(inventory.restock.mock.calls).toHaveLength(0);
    expect(repository.applyTransition.mock.calls).toHaveLength(0);
  });

  it('restocks a processing order with the required Staff cancellation reason', async () => {
    const staff = { ...actor, role: UserRole.STAFF };
    const updated = storedOrder().order;
    repository.lockById.mockResolvedValue(lockedOrder(OrderStatus.PROCESSING));
    repository.findInventoryLines.mockResolvedValue([{ productId: productA, quantity: 2 }]);
    repository.applyTransition.mockResolvedValue(updated);
    inventory.restock.mockResolvedValue([]);

    await service.updateStatus({
      actor: staff,
      orderId,
      dto: { status: OrderStatus.CANCELLED, note: 'Customer refused delivery' },
      request: {},
      requestId: 'request-id',
    });

    expect(inventory.restock.mock.calls).toEqual([
      [
        transaction,
        [{ productId: productA, quantity: 2 }],
        {
          orderId,
          createdById: userId,
          reason: 'Customer refused delivery',
        },
      ],
    ]);
  });

  it('marks a shipping COD order complete without touching inventory', async () => {
    const admin = { ...actor, role: UserRole.ADMIN };
    const updated = storedOrder().order;
    repository.lockById.mockResolvedValue(lockedOrder(OrderStatus.SHIPPING));
    repository.applyTransition.mockResolvedValue(updated);

    await expect(
      service.updateStatus({
        actor: admin,
        orderId,
        dto: { status: OrderStatus.COMPLETED },
        request: {},
        requestId: 'request-id',
      }),
    ).resolves.toEqual(updated);

    expect(repository.findInventoryLines.mock.calls).toHaveLength(0);
    expect(inventory.commit.mock.calls).toHaveLength(0);
    expect(inventory.release.mock.calls).toHaveLength(0);
    expect(inventory.restock.mock.calls).toHaveLength(0);
    expectCallArgumentToMatch(repository.applyTransition.mock, 1, {
      orderId,
      fromStatus: OrderStatus.SHIPPING,
      toStatus: OrderStatus.COMPLETED,
      actorId: userId,
      note: null,
    });
  });

  it('hides a foreign customer order and does not mutate it', async () => {
    repository.lockOwnedByOrderNumber.mockResolvedValue(null);

    await expect(
      service.cancelOwn({
        actor,
        orderNumber: 'ORD-UNKNOWN',
        dto: {},
        request: {},
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({ status: 404, response: { code: 'ORDER_NOT_FOUND' } });

    expect(inventory.release.mock.calls).toHaveLength(0);
    expect(repository.applyTransition.mock.calls).toHaveLength(0);
  });

  it('rejects customer access to administrative order operations at the service boundary', async () => {
    await expect(
      service.updateStatus({
        actor,
        orderId,
        dto: { status: OrderStatus.CONFIRMED },
        request: {},
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({ status: 403, response: { code: 'AUTH_FORBIDDEN' } });

    expect(repository.lockById.mock.calls).toHaveLength(0);
  });

  it('rejects the loser of a concurrent status race without inventory or audit writes', async () => {
    const staff = { ...actor, role: UserRole.STAFF };
    repository.lockById.mockResolvedValue(lockedOrder(OrderStatus.CANCELLED));

    await expect(
      service.updateStatus({
        actor: staff,
        orderId,
        dto: { status: OrderStatus.CONFIRMED },
        request: {},
        requestId: 'request-id',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'INVALID_ORDER_TRANSITION' },
    });

    expect(repository.findInventoryLines.mock.calls).toHaveLength(0);
    expect(inventory.commit.mock.calls).toHaveLength(0);
    expect(repository.applyTransition.mock.calls).toHaveLength(0);
  });
});

function expectDecimal(value: string): { asymmetricMatch(actual: unknown): boolean } {
  return {
    asymmetricMatch(actual: unknown): boolean {
      return actual instanceof Prisma.Decimal && actual.equals(new Prisma.Decimal(value));
    },
  };
}

function expectCallArgumentToMatch(
  mock: { calls: unknown[][] },
  argumentIndex: number,
  expected: Record<string, unknown>,
): void {
  expect(mock.calls[0]?.[argumentIndex]).toMatchObject(expected);
}
