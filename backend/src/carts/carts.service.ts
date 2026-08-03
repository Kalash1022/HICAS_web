import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ApplicationException } from '../common/exceptions/application.exception';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { AddCartItemDto } from './dto/add-cart-item.dto';
import type { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartsRepository } from './carts.repository';
import type { CartCheckoutLine, CartItemView, CartView } from './carts.types';

const MAX_POSTGRES_INTEGER = 2_147_483_647;

@Injectable()
export class CartService {
  constructor(private readonly repository: CartsRepository) {}

  async get(actor: AuthenticatedUser): Promise<CartView> {
    return (
      (await this.repository.findForUser(actor.id)) ?? {
        id: null,
        items: [],
        itemCount: 0,
        subtotal: '0.00',
        updatedAt: null,
      }
    );
  }

  async add(input: { actor: AuthenticatedUser; dto: AddCartItemDto }): Promise<CartItemView> {
    const result = await this.repository.addItem({
      userId: input.actor.id,
      dto: input.dto,
      now: new Date(),
    });
    if (result.kind === 'updated') {
      return result.item;
    }
    this.throwProductNotFound();
  }

  async update(input: {
    actor: AuthenticatedUser;
    itemId: string;
    dto: UpdateCartItemDto;
  }): Promise<CartItemView> {
    const result = await this.repository.updateItem({
      userId: input.actor.id,
      itemId: input.itemId,
      dto: input.dto,
      now: new Date(),
    });
    if (result.kind === 'updated') {
      return result.item;
    }
    this.throwCartItemNotFound();
  }

  async delete(input: { actor: AuthenticatedUser; itemId: string }): Promise<{ deleted: true }> {
    const result = await this.repository.deleteItem({
      userId: input.actor.id,
      itemId: input.itemId,
      now: new Date(),
    });
    if (!result.deleted) {
      this.throwCartItemNotFound();
    }
    return { deleted: true };
  }

  /**
   * Checkout calls this with its already-open transaction after inventory has
   * been reserved. It never opens a nested transaction.
   */
  async removeCheckedOutItems(
    transaction: Prisma.TransactionClient,
    input: { userId: string; lines: CartCheckoutLine[]; now?: Date },
  ): Promise<void> {
    const lines = this.normalizeCheckoutLines(input.lines);
    const result = await this.repository.removeCheckedOutItems(transaction, {
      userId: input.userId,
      lines,
      now: input.now ?? new Date(),
    });
    if (result.kind === 'removed') {
      return;
    }
    if (result.kind === 'cart-not-found' || result.kind === 'item-not-found') {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'CART_ITEM_NOT_FOUND',
        'A cart item required for checkout no longer exists.',
        result.kind === 'item-not-found' ? { productId: result.productId } : undefined,
      );
    }
    throw new ApplicationException(
      HttpStatus.CONFLICT,
      'CART_ITEM_QUANTITY_CONFLICT',
      'The cart quantity changed before checkout could finish.',
      {
        productId: result.productId,
        quantity: result.quantity,
        requestedQuantity: result.requestedQuantity,
      },
    );
  }

  private normalizeCheckoutLines(lines: CartCheckoutLine[]): CartCheckoutLine[] {
    if (lines.length === 0) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'CART_ITEMS_REQUIRED',
        'At least one cart item is required for checkout.',
      );
    }

    const quantitiesByProductId = new Map<string, number>();
    for (const line of lines) {
      if (!line.productId || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
        throw new ApplicationException(
          HttpStatus.BAD_REQUEST,
          'CART_ITEM_INVALID',
          'Each checkout cart item must have a product ID and a positive integer quantity.',
        );
      }
      const quantity = (quantitiesByProductId.get(line.productId) ?? 0) + line.quantity;
      if (!Number.isSafeInteger(quantity) || quantity > MAX_POSTGRES_INTEGER) {
        throw new ApplicationException(
          HttpStatus.BAD_REQUEST,
          'CART_ITEM_INVALID',
          'The requested checkout quantity is too large.',
          { productId: line.productId },
        );
      }
      quantitiesByProductId.set(line.productId, quantity);
    }

    return [...quantitiesByProductId.entries()]
      .sort(([leftProductId], [rightProductId]) => leftProductId.localeCompare(rightProductId))
      .map(([productId, quantity]) => ({ productId, quantity }));
  }

  private throwProductNotFound(): never {
    throw new ApplicationException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }

  private throwCartItemNotFound(): never {
    throw new ApplicationException(
      HttpStatus.NOT_FOUND,
      'CART_ITEM_NOT_FOUND',
      'Cart item not found.',
    );
  }
}
