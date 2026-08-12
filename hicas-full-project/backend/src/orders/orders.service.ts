import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma, UserRole } from '@prisma/client';

import { AddressesService } from '../addresses/addresses.service';
import type { RequestContext } from '../auth/auth.types';
import { CartService } from '../carts/carts.service';
import { ApplicationException } from '../common/exceptions/application.exception';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { DatabaseService } from '../database/database.service';
import { InventoryService } from '../inventory/inventory.service';
import { generateOrderNumber, prepareCheckoutRequest } from './checkout-idempotency';
import { CheckoutRateLimiterService } from './checkout-rate-limiter.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import type { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { getOrderTransitionPlan, type OrderInventoryOperation } from './order-transition.policy';
import { OrdersRepository } from './orders.repository';
import type {
  AdminOrderDetail,
  AdminOrderSummary,
  CanonicalCheckoutRequest,
  CheckoutOrderLine,
  CheckoutResult,
  CheckoutProduct,
  LockedOrder,
  OrderDetail,
  OrderInventoryLine,
  OrderSummary,
  OrderView,
  StoredOrder,
} from './orders.types';

const MAX_ORDER_AMOUNT = new Prisma.Decimal('999999999999.99');
const CHECKOUT_RESERVATION_REASON = 'Checkout reservation';

function isIdempotencyUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const targetText = Array.isArray(target)
    ? target.filter((part): part is string => typeof part === 'string').join(',')
    : typeof target === 'string'
      ? target
      : '';
  return targetText.toLowerCase().includes('idempotency');
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: OrdersRepository,
    private readonly addresses: AddressesService,
    private readonly inventory: InventoryService,
    private readonly carts: CartService,
    private readonly config: ConfigService,
    private readonly checkoutRateLimiter: CheckoutRateLimiterService,
  ) {}

  async checkout(input: {
    actor: AuthenticatedUser;
    dto: CreateOrderDto;
    idempotencyKey: unknown;
    request: RequestContext;
  }): Promise<CheckoutResult> {
    const checkout = prepareCheckoutRequest(input.dto, input.idempotencyKey);
    this.checkoutRateLimiter.consume(input.actor.id, input.request.ipAddress);

    const existing = await this.repository.findByIdempotency(
      input.actor.id,
      checkout.idempotencyKey,
    );
    if (existing) {
      return this.resolveIdempotency(existing, checkout.requestHash);
    }

    try {
      return await this.database.$transaction((transaction) =>
        this.checkoutInTransaction(transaction, input.actor, checkout),
      );
    } catch (error) {
      if (isIdempotencyUniqueConstraintViolation(error)) {
        const racedOrder = await this.repository.findByIdempotency(
          input.actor.id,
          checkout.idempotencyKey,
        );
        if (racedOrder) {
          return this.resolveIdempotency(racedOrder, checkout.requestHash);
        }
      }
      throw error;
    }
  }

  listOwn(
    actor: AuthenticatedUser,
    query: ListOrdersQueryDto,
  ): Promise<PaginatedResult<OrderSummary>> {
    return this.repository.listForUser(actor.id, query);
  }

  async getOwn(actor: AuthenticatedUser, orderNumber: string): Promise<OrderDetail> {
    const order = await this.repository.findForUser(actor.id, orderNumber);
    if (!order) {
      this.throwOrderNotFound();
    }
    return order;
  }

  listAdmin(
    actor: AuthenticatedUser,
    query: ListOrdersQueryDto,
  ): Promise<PaginatedResult<AdminOrderSummary>> {
    this.assertOrderManager(actor);
    return this.repository.listForAdmin(query);
  }

  async getAdmin(actor: AuthenticatedUser, orderId: string): Promise<AdminOrderDetail> {
    this.assertOrderManager(actor);
    const order = await this.repository.findForAdmin(orderId);
    if (!order) {
      this.throwOrderNotFound();
    }
    return order;
  }

  async cancelOwn(input: {
    actor: AuthenticatedUser;
    orderNumber: string;
    dto: CancelOrderDto;
    request: RequestContext;
    requestId: string;
  }): Promise<OrderView> {
    const note = this.normalizeTransitionNote(input.dto.note);
    return this.database.$transaction(async (transaction) => {
      const lockedOrder = await this.repository.lockOwnedByOrderNumber(
        transaction,
        input.actor.id,
        input.orderNumber,
      );
      if (!lockedOrder) {
        this.throwOrderNotFound();
      }
      return this.applyLockedTransition({
        transaction,
        actor: input.actor,
        lockedOrder,
        toStatus: OrderStatus.CANCELLED,
        note,
        request: input.request,
        requestId: input.requestId,
        customerCancellation: true,
      });
    });
  }

  async updateStatus(input: {
    actor: AuthenticatedUser;
    orderId: string;
    dto: UpdateOrderStatusDto;
    request: RequestContext;
    requestId: string;
  }): Promise<OrderView> {
    this.assertOrderManager(input.actor);
    const note = this.normalizeTransitionNote(input.dto.note);
    return this.database.$transaction(async (transaction) => {
      const lockedOrder = await this.repository.lockById(transaction, input.orderId);
      if (!lockedOrder) {
        this.throwOrderNotFound();
      }
      return this.applyLockedTransition({
        transaction,
        actor: input.actor,
        lockedOrder,
        toStatus: input.dto.status,
        note,
        request: input.request,
        requestId: input.requestId,
        customerCancellation: false,
      });
    });
  }

  private async checkoutInTransaction(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    checkout: CanonicalCheckoutRequest,
  ): Promise<CheckoutResult> {
    await this.repository.lockIdempotencyKey(transaction, actor.id, checkout.idempotencyKey);
    const existing = await this.repository.findByIdempotencyInTransaction(
      transaction,
      actor.id,
      checkout.idempotencyKey,
    );
    if (existing) {
      return this.resolveIdempotency(existing, checkout.requestHash);
    }

    const shippingSnapshot = await this.addresses.getOwnedShippingSnapshot(
      transaction,
      actor.id,
      checkout.addressId,
    );
    const productIds = checkout.items.map((item) => item.productId);
    const lockedInventory = await this.inventory.lockForProducts(transaction, productIds);
    const products = await this.repository.findPurchasableProducts(transaction, productIds);
    const lines = this.toCheckoutOrderLines(checkout, products);
    this.assertAvailableInventory(checkout, lockedInventory);
    const amounts = this.calculateAmounts(lines);
    const now = new Date();
    const created = await this.repository.createPending(transaction, {
      orderNumber: generateOrderNumber(now),
      userId: actor.id,
      shippingSnapshot,
      customerNote: checkout.customerNote,
      idempotencyKey: checkout.idempotencyKey,
      idempotencyRequestHash: checkout.requestHash,
      ...amounts,
      lines,
    });

    await this.inventory.reserve(transaction, checkout.items, {
      orderId: created.order.id,
      createdById: actor.id,
      reason: CHECKOUT_RESERVATION_REASON,
    });
    await this.carts.removeCheckedOutItems(transaction, {
      userId: actor.id,
      lines: checkout.items,
      now,
    });

    return { order: created.order, replayed: false };
  }

  private async applyLockedTransition(input: {
    transaction: Prisma.TransactionClient;
    actor: AuthenticatedUser;
    lockedOrder: LockedOrder;
    toStatus: OrderStatus;
    note: string | null;
    request: RequestContext;
    requestId: string;
    customerCancellation: boolean;
  }): Promise<OrderView> {
    if (
      input.customerCancellation &&
      (input.lockedOrder.status !== OrderStatus.PENDING || input.toStatus !== OrderStatus.CANCELLED)
    ) {
      this.throwInvalidTransition(input.lockedOrder.status, input.toStatus);
    }

    const plan = getOrderTransitionPlan(input.lockedOrder.status, input.toStatus);
    if (!plan) {
      this.throwInvalidTransition(input.lockedOrder.status, input.toStatus);
    }
    if (plan.requiresCancellationNote && !input.note) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'ORDER_CANCELLATION_REASON_REQUIRED',
        'A cancellation reason is required for a confirmed or processing order.',
      );
    }

    if (plan.inventoryOperation) {
      const inventoryLines = await this.repository.findInventoryLines(
        input.transaction,
        input.lockedOrder.id,
      );
      const lines = this.normalizeOrderInventoryLines(inventoryLines, input.lockedOrder.id);
      await this.applyInventoryTransition(
        input.transaction,
        plan.inventoryOperation,
        lines,
        input.lockedOrder.id,
        input.actor.id,
        input.note,
        input.customerCancellation,
      );
    }

    return this.repository.applyTransition(input.transaction, {
      orderId: input.lockedOrder.id,
      fromStatus: input.lockedOrder.status,
      fromPaymentStatus: input.lockedOrder.paymentStatus,
      fromPaidAt: input.lockedOrder.paidAt,
      toStatus: input.toStatus,
      actorId: input.actor.id,
      note: input.note,
      request: input.request,
      requestId: input.requestId,
      now: new Date(),
    });
  }

  private async applyInventoryTransition(
    transaction: Prisma.TransactionClient,
    operation: Exclude<OrderInventoryOperation, null>,
    lines: Array<{ productId: string; quantity: number }>,
    orderId: string,
    actorId: string,
    note: string | null,
    customerCancellation: boolean,
  ): Promise<void> {
    const context = {
      orderId,
      createdById: actorId,
      reason: this.inventoryTransitionReason(operation, note, customerCancellation),
    };
    if (operation === 'commit') {
      await this.inventory.commit(transaction, lines, context);
      return;
    }
    if (operation === 'release') {
      await this.inventory.release(transaction, lines, context);
      return;
    }
    await this.inventory.restock(transaction, lines, context);
  }

  private normalizeOrderInventoryLines(
    lines: OrderInventoryLine[],
    orderId: string,
  ): Array<{ productId: string; quantity: number }> {
    if (lines.length === 0) {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'INVENTORY_NOT_FOUND',
        'This order has no inventory lines to transition.',
        { orderId },
      );
    }

    const quantitiesByProductId = new Map<string, number>();
    for (const line of lines) {
      if (!line.productId || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          'INVENTORY_NOT_FOUND',
          'This order has an item that cannot be reconciled with inventory.',
          { orderId },
        );
      }
      const quantity = (quantitiesByProductId.get(line.productId) ?? 0) + line.quantity;
      if (!Number.isSafeInteger(quantity) || quantity > 2_147_483_647) {
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          'INVENTORY_NOT_FOUND',
          'This order has an invalid inventory quantity.',
          { orderId, productId: line.productId },
        );
      }
      quantitiesByProductId.set(line.productId, quantity);
    }

    return [...quantitiesByProductId.entries()]
      .sort(([leftProductId], [rightProductId]) => leftProductId.localeCompare(rightProductId))
      .map(([productId, quantity]) => ({ productId, quantity }));
  }

  private inventoryTransitionReason(
    operation: Exclude<OrderInventoryOperation, null>,
    note: string | null,
    customerCancellation: boolean,
  ): string {
    if (operation === 'commit') {
      return 'Order confirmed';
    }
    if (operation === 'restock') {
      return note ?? 'Order cancelled after confirmation';
    }
    return customerCancellation ? 'Order cancelled by customer' : 'Order cancelled by staff';
  }

  private resolveIdempotency(existing: StoredOrder, requestHash: string): CheckoutResult {
    if (existing.idempotencyRequestHash !== requestHash) {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_KEY_CONFLICT',
        'This Idempotency-Key has already been used with a different checkout request.',
      );
    }
    return { order: existing.order, replayed: true };
  }

  private assertAvailableInventory(
    checkout: CanonicalCheckoutRequest,
    lockedInventory: Array<{ productId: string; quantity: number; reservedQuantity: number }>,
  ): void {
    const inventoryByProductId = new Map(
      lockedInventory.map((inventory) => [inventory.productId, inventory]),
    );
    for (const item of checkout.items) {
      const inventory = inventoryByProductId.get(item.productId);
      if (!inventory) {
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          'INVENTORY_NOT_FOUND',
          'The product does not have an inventory record.',
          { productId: item.productId },
        );
      }
      const available = inventory.quantity - inventory.reservedQuantity;
      if (available < item.quantity) {
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          'PRODUCT_OUT_OF_STOCK',
          'The requested quantity is not available.',
          { productId: item.productId, available },
        );
      }
    }
  }

  private toCheckoutOrderLines(
    checkout: CanonicalCheckoutRequest,
    products: CheckoutProduct[],
  ): CheckoutOrderLine[] {
    const productsById = new Map(products.map((product) => [product.id, product]));
    return checkout.items.map((item) => {
      const product = productsById.get(item.productId);
      if (!product) {
        throw new ApplicationException(
          HttpStatus.NOT_FOUND,
          'PRODUCT_NOT_FOUND',
          'Product not found.',
        );
      }
      const lineTotal = product.price.mul(item.quantity);
      this.assertRepresentableAmount(lineTotal);
      return {
        ...item,
        product,
        unitPrice: product.price,
        lineTotal,
      };
    });
  }

  private calculateAmounts(lines: CheckoutOrderLine[]): {
    subtotal: Prisma.Decimal;
    shippingFee: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  } {
    const subtotal = lines.reduce(
      (total, line) => total.plus(line.lineTotal),
      new Prisma.Decimal(0),
    );
    const shippingFee = new Prisma.Decimal(
      this.config.getOrThrow<number>('DEFAULT_SHIPPING_FEE_VND'),
    );
    const discountAmount = new Prisma.Decimal(0);
    const totalAmount = subtotal.plus(shippingFee).minus(discountAmount);
    this.assertRepresentableAmount(subtotal);
    this.assertRepresentableAmount(shippingFee);
    this.assertRepresentableAmount(totalAmount);

    return { subtotal, shippingFee, discountAmount, totalAmount };
  }

  private assertRepresentableAmount(amount: Prisma.Decimal): void {
    if (amount.isNegative() || amount.greaterThan(MAX_ORDER_AMOUNT)) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'ORDER_TOTAL_TOO_LARGE',
        'The checkout amount is outside the supported range.',
      );
    }
  }

  private normalizeTransitionNote(note: string | undefined): string | null {
    const normalized = note?.trim();
    return normalized ? normalized : null;
  }

  private assertOrderManager(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.STAFF && actor.role !== UserRole.ADMIN) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_FORBIDDEN',
        'You do not have permission to manage orders.',
      );
    }
  }

  private throwOrderNotFound(): never {
    throw new ApplicationException(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found.');
  }

  private throwInvalidTransition(fromStatus: OrderStatus, toStatus: OrderStatus): never {
    throw new ApplicationException(
      HttpStatus.CONFLICT,
      'INVALID_ORDER_TRANSITION',
      `Cannot transition an order from ${fromStatus} to ${toStatus}.`,
      { fromStatus, toStatus },
    );
  }
}
