import { Injectable } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';

import { DatabaseService } from '../database/database.service';
import type { AddCartItemDto } from './dto/add-cart-item.dto';
import type { UpdateCartItemDto } from './dto/update-cart-item.dto';
import type {
  CartCheckoutLine,
  CartCheckoutRemovalResult,
  CartItemMutationResult,
  CartItemView,
  CartView,
} from './carts.types';

interface CartItemRecord {
  id: string;
  productId: string;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
  product: {
    id: string;
    name: string;
    slug: string;
    price: Prisma.Decimal;
    compareAtPrice: Prisma.Decimal | null;
    status: ProductStatus;
    deletedAt: Date | null;
    category: { isActive: boolean };
    images: Array<{
      id: string;
      url: string;
      altText: string | null;
      sortOrder: number;
      isPrimary: boolean;
    }>;
  };
}

interface CartRecord {
  id: string;
  updatedAt: Date;
  items: CartItemRecord[];
}

interface LockedCart {
  id: string;
}

interface LockedCartItem {
  id: string;
  productId: string;
  quantity: number;
}

@Injectable()
export class CartsRepository {
  constructor(private readonly database: DatabaseService) {}

  async findForUser(userId: string): Promise<CartView | null> {
    const cart = await this.database.cart.findUnique({
      where: { userId },
      select: this.cartSelect(),
    });
    return cart ? this.toCartView(cart) : null;
  }

  async addItem(input: {
    userId: string;
    dto: AddCartItemDto;
    now: Date;
  }): Promise<CartItemMutationResult> {
    return this.database.$transaction(async (transaction) => {
      const product = await transaction.product.findFirst({
        where: this.purchasableProductWhere(input.dto.productId),
        select: { id: true },
      });
      if (!product) {
        return { kind: 'product-not-found' };
      }

      const cart = await this.getOrCreateAndLockCart(transaction, input.userId);
      const item = await transaction.cartItem.upsert({
        where: {
          cartId_productId: {
            cartId: cart.id,
            productId: product.id,
          },
        },
        create: {
          cartId: cart.id,
          productId: product.id,
          quantity: input.dto.quantity,
        },
        update: {
          quantity: { increment: input.dto.quantity },
        },
        select: this.cartItemSelect(),
      });
      await this.touchCart(transaction, cart.id, input.now);

      return { kind: 'updated', item: this.toCartItemView(item) };
    });
  }

  async updateItem(input: {
    userId: string;
    itemId: string;
    dto: UpdateCartItemDto;
    now: Date;
  }): Promise<CartItemMutationResult> {
    return this.database.$transaction(async (transaction) => {
      const cart = await this.lockCartForUser(transaction, input.userId);
      if (!cart) {
        return { kind: 'item-not-found' };
      }

      const updated = await transaction.cartItem.updateMany({
        where: { id: input.itemId, cartId: cart.id },
        data: { quantity: input.dto.quantity },
      });
      if (updated.count !== 1) {
        return { kind: 'item-not-found' };
      }
      await this.touchCart(transaction, cart.id, input.now);

      const item = await transaction.cartItem.findUnique({
        where: { id: input.itemId },
        select: this.cartItemSelect(),
      });
      if (!item) {
        return { kind: 'item-not-found' };
      }
      return { kind: 'updated', item: this.toCartItemView(item) };
    });
  }

  async deleteItem(input: {
    userId: string;
    itemId: string;
    now: Date;
  }): Promise<{ deleted: boolean }> {
    return this.database.$transaction(async (transaction) => {
      const cart = await this.lockCartForUser(transaction, input.userId);
      if (!cart) {
        return { deleted: false };
      }

      const deleted = await transaction.cartItem.deleteMany({
        where: { id: input.itemId, cartId: cart.id },
      });
      if (deleted.count !== 1) {
        return { deleted: false };
      }
      await this.touchCart(transaction, cart.id, input.now);
      return { deleted: true };
    });
  }

  async removeCheckedOutItems(
    transaction: Prisma.TransactionClient,
    input: { userId: string; lines: CartCheckoutLine[]; now: Date },
  ): Promise<CartCheckoutRemovalResult> {
    const cart = await this.lockCartForUser(transaction, input.userId);
    if (!cart) {
      return { kind: 'cart-not-found' };
    }

    const lockedItems = await this.lockCartItemsForProducts(
      transaction,
      cart.id,
      input.lines.map((line) => line.productId),
    );
    const itemsByProductId = new Map(lockedItems.map((item) => [item.productId, item]));
    for (const line of input.lines) {
      const item = itemsByProductId.get(line.productId);
      if (!item) {
        return { kind: 'item-not-found', productId: line.productId };
      }
      if (item.quantity < line.quantity) {
        return {
          kind: 'insufficient-quantity',
          productId: line.productId,
          quantity: item.quantity,
          requestedQuantity: line.quantity,
        };
      }
    }

    for (const line of input.lines) {
      const item = itemsByProductId.get(line.productId);
      if (!item) {
        continue;
      }
      if (item.quantity === line.quantity) {
        await transaction.cartItem.delete({ where: { id: item.id } });
      } else {
        await transaction.cartItem.update({
          where: { id: item.id },
          data: { quantity: item.quantity - line.quantity },
        });
      }
    }
    await this.touchCart(transaction, cart.id, input.now);
    return { kind: 'removed' };
  }

  private async getOrCreateAndLockCart(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<LockedCart> {
    await transaction.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });
    const cart = await this.lockCartForUser(transaction, userId);
    if (!cart) {
      throw new Error('Cart could not be created or locked.');
    }
    return cart;
  }

  private async lockCartForUser(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<LockedCart | null> {
    const rows = await transaction.$queryRaw<LockedCart[]>`
      SELECT id
      FROM carts
      WHERE user_id = ${userId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private lockCartItemsForProducts(
    transaction: Prisma.TransactionClient,
    cartId: string,
    productIds: string[],
  ): Promise<LockedCartItem[]> {
    const stableProductIds = [...new Set(productIds)].sort((left, right) =>
      left.localeCompare(right),
    );
    if (stableProductIds.length === 0) {
      return Promise.resolve([]);
    }

    const ids = Prisma.join(stableProductIds.map((productId) => Prisma.sql`${productId}::uuid`));
    return transaction.$queryRaw<LockedCartItem[]>(Prisma.sql`
      SELECT
        id,
        product_id AS "productId",
        quantity
      FROM cart_items
      WHERE cart_id = ${cartId}::uuid
        AND product_id IN (${ids})
      ORDER BY product_id
      FOR UPDATE
    `);
  }

  private touchCart(
    transaction: Prisma.TransactionClient,
    cartId: string,
    now: Date,
  ): Promise<unknown> {
    return transaction.cart.update({
      where: { id: cartId },
      data: { updatedAt: now },
    });
  }

  private cartSelect() {
    return {
      id: true,
      updatedAt: true,
      items: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: this.cartItemSelect(),
      },
    } satisfies Prisma.CartSelect;
  }

  private cartItemSelect() {
    return {
      id: true,
      productId: true,
      quantity: true,
      createdAt: true,
      updatedAt: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          compareAtPrice: true,
          status: true,
          deletedAt: true,
          category: { select: { isActive: true } },
          images: {
            where: { isPrimary: true },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            take: 1,
            select: {
              id: true,
              url: true,
              altText: true,
              sortOrder: true,
              isPrimary: true,
            },
          },
        },
      },
    } satisfies Prisma.CartItemSelect;
  }

  private purchasableProductWhere(productId: string): Prisma.ProductWhereInput {
    return {
      id: productId,
      status: ProductStatus.ACTIVE,
      deletedAt: null,
      category: { is: { isActive: true } },
    };
  }

  private toCartView(cart: CartRecord): CartView {
    const items = cart.items.map((item) => this.toCartItemView(item));
    const subtotal = cart.items.reduce(
      (total, item) => total.plus(item.product.price.mul(item.quantity)),
      new Prisma.Decimal(0),
    );
    return {
      id: cart.id,
      items,
      itemCount: items.reduce((total, item) => total + item.quantity, 0),
      subtotal: subtotal.toFixed(2),
      updatedAt: cart.updatedAt,
    };
  }

  private toCartItemView(item: CartItemRecord): CartItemView {
    const isPurchasable =
      item.product.status === ProductStatus.ACTIVE &&
      item.product.deletedAt === null &&
      item.product.category.isActive;
    return {
      id: item.id,
      quantity: item.quantity,
      lineTotal: item.product.price.mul(item.quantity).toFixed(2),
      product: {
        id: item.product.id,
        name: item.product.name,
        slug: item.product.slug,
        price: item.product.price.toFixed(2),
        compareAtPrice: item.product.compareAtPrice?.toFixed(2) ?? null,
        primaryImage: item.product.images[0] ?? null,
        isPurchasable,
      },
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
