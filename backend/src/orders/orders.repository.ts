import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  CurrencyCode,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';

import type { ShippingAddressSnapshot } from '../addresses/addresses.types';
import type { RequestContext } from '../auth/auth.types';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import { DatabaseService } from '../database/database.service';
import type { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import type {
  AdminOrderDetail,
  AdminOrderSummary,
  CheckoutProduct,
  CreatePendingOrderInput,
  LockedOrder,
  OrderDetail,
  OrderInventoryLine,
  OrderStatusHistoryView,
  OrderSummary,
  OrderView,
  StoredOrder,
} from './orders.types';

interface OrderItemRecord {
  id: string;
  productId: string | null;
  productName: string;
  productSku: string;
  productImageUrl: string | null;
  unitPrice: Prisma.Decimal;
  quantity: number;
  lineTotal: Prisma.Decimal;
}

interface OrderRecord {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paidAt: Date | null;
  subtotal: Prisma.Decimal;
  shippingFee: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  currency: CurrencyCode;
  shippingSnapshot: Prisma.JsonValue;
  customerNote: string | null;
  idempotencyRequestHash: string;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemRecord[];
}

interface OrderStatusHistoryRecord {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  createdAt: Date;
}

interface OrderDetailRecord extends OrderRecord {
  statusHistory: OrderStatusHistoryRecord[];
}

interface OrderCustomerRecord {
  id: string;
  email: string;
  fullName: string;
}

interface AdminOrderDetailRecord extends OrderDetailRecord {
  user: OrderCustomerRecord;
}

interface OrderSummaryRecord {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotal: Prisma.Decimal;
  shippingFee: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  currency: CurrencyCode;
  createdAt: Date;
  updatedAt: Date;
  _count: { items: number };
}

interface AdminOrderSummaryRecord extends OrderSummaryRecord {
  user: OrderCustomerRecord;
}

interface ApplyTransitionInput {
  orderId: string;
  fromStatus: OrderStatus;
  fromPaymentStatus: PaymentStatus;
  fromPaidAt: Date | null;
  toStatus: OrderStatus;
  actorId: string;
  note: string | null;
  request: RequestContext;
  requestId: string;
  now: Date;
}

type OrderReadClient = Pick<Prisma.TransactionClient, 'order'>;

function isJsonRecord(value: Prisma.JsonValue): value is Record<string, Prisma.JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class OrdersRepository {
  constructor(private readonly database: DatabaseService) {}

  findByIdempotency(userId: string, idempotencyKey: string): Promise<StoredOrder | null> {
    return this.findByIdempotencyWithClient(this.database, userId, idempotencyKey);
  }

  findByIdempotencyInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    idempotencyKey: string,
  ): Promise<StoredOrder | null> {
    return this.findByIdempotencyWithClient(transaction, userId, idempotencyKey);
  }

  async lockIdempotencyKey(
    transaction: Prisma.TransactionClient,
    userId: string,
    idempotencyKey: string,
  ): Promise<void> {
    // Transaction-scoped advisory locking lets a concurrent identical retry
    // observe the order before it can lock inventory or mutate the cart.
    await transaction.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${userId}:${idempotencyKey}`}, 0::bigint)
      )
    `);
  }

  async findPurchasableProducts(
    transaction: Prisma.TransactionClient,
    productIds: string[],
  ): Promise<CheckoutProduct[]> {
    const products = await transaction.product.findMany({
      where: {
        id: { in: productIds },
        status: ProductStatus.ACTIVE,
        deletedAt: null,
        category: { is: { isActive: true } },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        images: {
          where: { isPrimary: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { url: true },
        },
      },
    });
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      primaryImageUrl: product.images[0]?.url ?? null,
    }));
  }

  async createPending(
    transaction: Prisma.TransactionClient,
    input: CreatePendingOrderInput,
  ): Promise<StoredOrder> {
    const order = await transaction.order.create({
      data: {
        orderNumber: input.orderNumber,
        userId: input.userId,
        status: OrderStatus.PENDING,
        paymentMethod: PaymentMethod.COD,
        paymentStatus: PaymentStatus.UNPAID,
        paidAt: null,
        subtotal: input.subtotal,
        shippingFee: input.shippingFee,
        discountAmount: input.discountAmount,
        totalAmount: input.totalAmount,
        currency: CurrencyCode.VND,
        shippingSnapshot: this.toShippingSnapshotJson(input.shippingSnapshot),
        customerNote: input.customerNote,
        idempotencyKey: input.idempotencyKey,
        idempotencyRequestHash: input.idempotencyRequestHash,
        items: {
          create: input.lines.map((line) => ({
            productId: line.productId,
            productName: line.product.name,
            productSku: line.product.sku,
            productImageUrl: line.product.primaryImageUrl,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
          })),
        },
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: OrderStatus.PENDING,
            changedById: input.userId,
            note: null,
          },
        },
      },
      select: this.orderSelect(),
    });
    return this.toStoredOrder(order);
  }

  async listForUser(
    userId: string,
    query: ListOrdersQueryDto,
  ): Promise<PaginatedResult<OrderSummary>> {
    const where: Prisma.OrderWhereInput = {
      userId,
      ...(query.status === undefined ? {} : { status: query.status }),
    };
    const [orders, total] = await this.database.$transaction([
      this.database.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: this.orderSummarySelect(),
      }),
      this.database.order.count({ where }),
    ]);
    return this.toPaginatedSummaries(orders, query, total);
  }

  async listForAdmin(query: ListOrdersQueryDto): Promise<PaginatedResult<AdminOrderSummary>> {
    const where: Prisma.OrderWhereInput =
      query.status === undefined ? {} : { status: query.status };
    const [orders, total] = await this.database.$transaction([
      this.database.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: this.adminOrderSummarySelect(),
      }),
      this.database.order.count({ where }),
    ]);
    return {
      data: orders.map((order) => this.toAdminSummary(order)),
      pagination: this.pagination(query, total),
    };
  }

  async findForUser(userId: string, orderNumber: string): Promise<OrderDetail | null> {
    const order = await this.database.order.findFirst({
      where: { userId, orderNumber },
      select: this.orderDetailSelect(),
    });
    return order ? this.toDetail(order) : null;
  }

  async findForAdmin(orderId: string): Promise<AdminOrderDetail | null> {
    const order = await this.database.order.findUnique({
      where: { id: orderId },
      select: this.adminOrderDetailSelect(),
    });
    return order ? this.toAdminDetail(order) : null;
  }

  async lockOwnedByOrderNumber(
    transaction: Prisma.TransactionClient,
    userId: string,
    orderNumber: string,
  ): Promise<LockedOrder | null> {
    const rows = await transaction.$queryRaw<LockedOrder[]>`
      SELECT
        id,
        status,
        payment_status AS "paymentStatus",
        paid_at AS "paidAt"
      FROM orders
      WHERE user_id = ${userId}::uuid
        AND order_number = ${orderNumber}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async lockById(
    transaction: Prisma.TransactionClient,
    orderId: string,
  ): Promise<LockedOrder | null> {
    const rows = await transaction.$queryRaw<LockedOrder[]>`
      SELECT
        id,
        status,
        payment_status AS "paymentStatus",
        paid_at AS "paidAt"
      FROM orders
      WHERE id = ${orderId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  findInventoryLines(
    transaction: Prisma.TransactionClient,
    orderId: string,
  ): Promise<OrderInventoryLine[]> {
    return transaction.orderItem.findMany({
      where: { orderId },
      orderBy: { productId: 'asc' },
      select: { productId: true, quantity: true },
    });
  }

  async applyTransition(
    transaction: Prisma.TransactionClient,
    input: ApplyTransitionInput,
  ): Promise<OrderView> {
    const paymentStatus =
      input.toStatus === OrderStatus.COMPLETED ? PaymentStatus.PAID : PaymentStatus.UNPAID;
    const paidAt = input.toStatus === OrderStatus.COMPLETED ? input.now : null;
    const order = await transaction.order.update({
      where: { id: input.orderId },
      data: {
        status: input.toStatus,
        paymentStatus,
        paidAt,
      },
      select: this.orderSelect(),
    });
    await transaction.orderStatusHistory.create({
      data: {
        orderId: input.orderId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        changedById: input.actorId,
        note: input.note,
      },
    });
    await transaction.auditLog.create({
      data: {
        actorId: input.actorId,
        action: AuditAction.ORDER_STATUS_CHANGED,
        entityType: 'ORDER',
        entityId: input.orderId,
        beforeData: this.transitionAuditSnapshot(
          input.fromStatus,
          input.fromPaymentStatus,
          input.fromPaidAt,
        ),
        afterData: this.transitionAuditSnapshot(input.toStatus, paymentStatus, paidAt),
        ipAddress: input.request.ipAddress,
        requestId: input.requestId,
      },
    });
    return this.toStoredOrder(order).order;
  }

  private async findByIdempotencyWithClient(
    client: OrderReadClient,
    userId: string,
    idempotencyKey: string,
  ): Promise<StoredOrder | null> {
    const order = await client.order.findFirst({
      where: { userId, idempotencyKey },
      select: this.orderSelect(),
    });
    return order ? this.toStoredOrder(order) : null;
  }

  private orderSelect() {
    return {
      id: true,
      orderNumber: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      paidAt: true,
      subtotal: true,
      shippingFee: true,
      discountAmount: true,
      totalAmount: true,
      currency: true,
      shippingSnapshot: true,
      customerNote: true,
      idempotencyRequestHash: true,
      createdAt: true,
      updatedAt: true,
      items: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          productId: true,
          productName: true,
          productSku: true,
          productImageUrl: true,
          unitPrice: true,
          quantity: true,
          lineTotal: true,
        },
      },
    } satisfies Prisma.OrderSelect;
  }

  private orderDetailSelect() {
    return {
      ...this.orderSelect(),
      statusHistory: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          note: true,
          createdAt: true,
        },
      },
    } satisfies Prisma.OrderSelect;
  }

  private adminOrderDetailSelect() {
    return {
      ...this.orderDetailSelect(),
      user: { select: this.orderCustomerSelect() },
    } satisfies Prisma.OrderSelect;
  }

  private orderSummarySelect() {
    return {
      id: true,
      orderNumber: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      subtotal: true,
      shippingFee: true,
      discountAmount: true,
      totalAmount: true,
      currency: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { items: true } },
    } satisfies Prisma.OrderSelect;
  }

  private adminOrderSummarySelect() {
    return {
      ...this.orderSummarySelect(),
      user: { select: this.orderCustomerSelect() },
    } satisfies Prisma.OrderSelect;
  }

  private orderCustomerSelect() {
    return {
      id: true,
      email: true,
      fullName: true,
    } satisfies Prisma.UserSelect;
  }

  private toStoredOrder(order: OrderRecord): StoredOrder {
    return { order: this.toOrderView(order), idempotencyRequestHash: order.idempotencyRequestHash };
  }

  private toOrderView(order: OrderRecord): OrderView {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paidAt: order.paidAt,
      subtotal: order.subtotal.toFixed(2),
      shippingFee: order.shippingFee.toFixed(2),
      discountAmount: order.discountAmount.toFixed(2),
      totalAmount: order.totalAmount.toFixed(2),
      currency: order.currency,
      shippingSnapshot: this.fromShippingSnapshotJson(order.shippingSnapshot),
      customerNote: order.customerNote,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        productSku: item.productSku,
        productImageUrl: item.productImageUrl,
        unitPrice: item.unitPrice.toFixed(2),
        quantity: item.quantity,
        lineTotal: item.lineTotal.toFixed(2),
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private toDetail(order: OrderDetailRecord): OrderDetail {
    return {
      ...this.toOrderView(order),
      statusHistory: order.statusHistory.map((history) => this.toStatusHistory(history)),
    };
  }

  private toAdminDetail(order: AdminOrderDetailRecord): AdminOrderDetail {
    return {
      ...this.toDetail(order),
      customer: this.toCustomer(order.user),
    };
  }

  private toPaginatedSummaries(
    orders: OrderSummaryRecord[],
    query: ListOrdersQueryDto,
    total: number,
  ): PaginatedResult<OrderSummary> {
    return {
      data: orders.map((order) => this.toSummary(order)),
      pagination: this.pagination(query, total),
    };
  }

  private pagination(query: ListOrdersQueryDto, total: number) {
    return {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  private toSummary(order: OrderSummaryRecord): OrderSummary {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      subtotal: order.subtotal.toFixed(2),
      shippingFee: order.shippingFee.toFixed(2),
      discountAmount: order.discountAmount.toFixed(2),
      totalAmount: order.totalAmount.toFixed(2),
      currency: order.currency,
      itemCount: order._count.items,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private toAdminSummary(order: AdminOrderSummaryRecord): AdminOrderSummary {
    return {
      ...this.toSummary(order),
      customer: this.toCustomer(order.user),
    };
  }

  private toCustomer(customer: OrderCustomerRecord) {
    return {
      id: customer.id,
      email: customer.email,
      fullName: customer.fullName,
    };
  }

  private toStatusHistory(history: OrderStatusHistoryRecord): OrderStatusHistoryView {
    return {
      id: history.id,
      fromStatus: history.fromStatus,
      toStatus: history.toStatus,
      note: history.note,
      createdAt: history.createdAt,
    };
  }

  private transitionAuditSnapshot(
    status: OrderStatus,
    paymentStatus: PaymentStatus,
    paidAt: Date | null,
  ): Prisma.InputJsonObject {
    return {
      status,
      paymentStatus,
      paidAt: paidAt?.toISOString() ?? null,
    };
  }

  private toShippingSnapshotJson(snapshot: ShippingAddressSnapshot): Prisma.InputJsonObject {
    return {
      recipientName: snapshot.recipientName,
      phone: snapshot.phone,
      province: snapshot.province,
      district: snapshot.district,
      ward: snapshot.ward,
      street: snapshot.street,
      postalCode: snapshot.postalCode,
    };
  }

  private fromShippingSnapshotJson(value: Prisma.JsonValue): ShippingAddressSnapshot {
    if (!isJsonRecord(value)) {
      throw new Error('Order shipping snapshot has an invalid shape.');
    }
    const fields = ['recipientName', 'phone', 'province', 'district', 'ward', 'street'] as const;
    if (fields.some((field) => typeof value[field] !== 'string')) {
      throw new Error('Order shipping snapshot has an invalid shape.');
    }
    const postalCode = value.postalCode;
    if (postalCode !== null && typeof postalCode !== 'string') {
      throw new Error('Order shipping snapshot has an invalid shape.');
    }

    return {
      recipientName: value.recipientName as string,
      phone: value.phone as string,
      province: value.province as string,
      district: value.district as string,
      ward: value.ward as string,
      street: value.street as string,
      postalCode,
    };
  }
}
