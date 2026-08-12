import { HttpStatus, Injectable } from '@nestjs/common';
import {
  InventoryTransactionType,
  Prisma,
  UserRole,
  type InventoryTransaction,
} from '@prisma/client';

import type { RequestContext } from '../auth/auth.types';
import { ApplicationException } from '../common/exceptions/application.exception';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import type { ListInventoryTransactionsQueryDto } from './dto/list-inventory-transactions-query.dto';
import { InventoryRepository } from './inventory.repository';
import type {
  InventoryAdjustmentResult,
  InventoryMutation,
  InventoryOperationContext,
  InventoryQuantityLine,
  InventorySnapshot,
  LockedInventory,
} from './inventory.types';

const MAX_POSTGRES_INTEGER = 2_147_483_647;

@Injectable()
export class InventoryService {
  constructor(private readonly repository: InventoryRepository) {}

  async listTransactions(
    actor: AuthenticatedUser,
    productId: string,
    query: ListInventoryTransactionsQueryDto,
  ): Promise<PaginatedResult<InventoryTransaction>> {
    this.assertInventoryManager(actor);
    const result = await this.repository.listTransactions(productId, query);
    if (result.kind === 'not-found') {
      this.throwProductNotFound();
    }
    return result.result;
  }

  async adjust(input: {
    actor: AuthenticatedUser;
    productId: string;
    dto: CreateInventoryAdjustmentDto;
    request: RequestContext;
    requestId: string;
  }): Promise<InventoryAdjustmentResult> {
    this.assertInventoryManager(input.actor);
    const result = await this.repository.adjust({
      actorId: input.actor.id,
      productId: input.productId,
      dto: input.dto,
      request: input.request,
      requestId: input.requestId,
    });
    if (result.kind === 'updated') {
      return result.result;
    }
    if (result.kind === 'not-found') {
      this.throwProductNotFound();
    }
    if (result.kind === 'version-conflict') {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'INVENTORY_VERSION_CONFLICT',
        'Inventory changed before this adjustment could be applied. Refresh and try again.',
        { expectedVersion: input.dto.expectedVersion, currentVersion: result.currentVersion },
      );
    }
    throw new ApplicationException(
      HttpStatus.CONFLICT,
      'INVENTORY_ADJUSTMENT_INVALID',
      'The requested adjustment would reduce quantity below the reserved stock.',
      {
        quantity: result.quantity,
        reservedQuantity: result.reservedQuantity,
        requestedDelta: result.requestedDelta,
      },
    );
  }

  /**
   * The Order module calls this before reading prices/statuses or mutating
   * stock. It intentionally does not create a nested Prisma transaction.
   */
  async lockForProducts(
    transaction: Prisma.TransactionClient,
    productIds: string[],
  ): Promise<LockedInventory[]> {
    const stableProductIds = this.stableProductIds(productIds);
    const locked = await this.repository.lockForProducts(transaction, stableProductIds);
    const lockedIds = new Set(locked.map((inventory) => inventory.productId));
    const missingProductIds = stableProductIds.filter((productId) => !lockedIds.has(productId));
    if (missingProductIds.length > 0) {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'INVENTORY_NOT_FOUND',
        'One or more products do not have an inventory record.',
        { productIds: missingProductIds },
      );
    }
    return locked;
  }

  reserve(
    transaction: Prisma.TransactionClient,
    lines: InventoryQuantityLine[],
    context: InventoryOperationContext,
  ): Promise<InventorySnapshot[]> {
    return this.applyOrderMutation(transaction, lines, context, InventoryTransactionType.RESERVE);
  }

  release(
    transaction: Prisma.TransactionClient,
    lines: InventoryQuantityLine[],
    context: InventoryOperationContext,
  ): Promise<InventorySnapshot[]> {
    return this.applyOrderMutation(transaction, lines, context, InventoryTransactionType.RELEASE);
  }

  commit(
    transaction: Prisma.TransactionClient,
    lines: InventoryQuantityLine[],
    context: InventoryOperationContext,
  ): Promise<InventorySnapshot[]> {
    return this.applyOrderMutation(transaction, lines, context, InventoryTransactionType.COMMIT);
  }

  restock(
    transaction: Prisma.TransactionClient,
    lines: InventoryQuantityLine[],
    context: InventoryOperationContext,
  ): Promise<InventorySnapshot[]> {
    return this.applyOrderMutation(transaction, lines, context, InventoryTransactionType.RESTOCK);
  }

  private async applyOrderMutation(
    transaction: Prisma.TransactionClient,
    lines: InventoryQuantityLine[],
    context: InventoryOperationContext,
    type: InventoryTransactionType,
  ): Promise<InventorySnapshot[]> {
    const normalizedLines = this.normalizeLines(lines);
    const reason = this.normalizeReason(context.reason);
    const locked = await this.lockForProducts(
      transaction,
      normalizedLines.map((line) => line.productId),
    );
    const inventoriesByProductId = new Map(
      locked.map((inventory) => [inventory.productId, inventory]),
    );
    const mutations = normalizedLines.map((line) => {
      const inventory = inventoriesByProductId.get(line.productId);
      if (!inventory) {
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          'INVENTORY_NOT_FOUND',
          'The product does not have an inventory record.',
          { productId: line.productId },
        );
      }
      return this.toMutation(inventory, line, type);
    });

    return this.repository.applyMutations(transaction, {
      mutations,
      context: {
        ...context,
        reason,
      },
    });
  }

  private toMutation(
    inventory: LockedInventory,
    line: InventoryQuantityLine,
    type: InventoryTransactionType,
  ): InventoryMutation {
    const quantityDelta =
      type === InventoryTransactionType.COMMIT
        ? -line.quantity
        : type === InventoryTransactionType.RESTOCK
          ? line.quantity
          : 0;
    const reservedDelta =
      type === InventoryTransactionType.RESERVE
        ? line.quantity
        : type === InventoryTransactionType.RELEASE || type === InventoryTransactionType.COMMIT
          ? -line.quantity
          : 0;
    const quantityAfter = inventory.quantity + quantityDelta;
    const reservedAfter = inventory.reservedQuantity + reservedDelta;

    if (quantityAfter < 0 || reservedAfter < 0 || reservedAfter > quantityAfter) {
      if (type === InventoryTransactionType.RESERVE) {
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          'PRODUCT_OUT_OF_STOCK',
          'The requested quantity is not available.',
          {
            productId: line.productId,
            available: inventory.quantity - inventory.reservedQuantity,
          },
        );
      }
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'INVENTORY_OPERATION_INVALID',
        'The inventory operation would violate the stock reservation invariant.',
        {
          productId: line.productId,
          quantity: inventory.quantity,
          reservedQuantity: inventory.reservedQuantity,
          requestedQuantity: line.quantity,
          operation: type,
        },
      );
    }

    return {
      productId: line.productId,
      type,
      quantityDelta,
      reservedDelta,
      quantityAfter,
      reservedAfter,
    };
  }

  private normalizeLines(lines: InventoryQuantityLine[]): InventoryQuantityLine[] {
    if (lines.length === 0) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'INVENTORY_LINES_REQUIRED',
        'At least one inventory line is required.',
      );
    }

    const quantitiesByProductId = new Map<string, number>();
    for (const line of lines) {
      if (!line.productId || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
        throw new ApplicationException(
          HttpStatus.BAD_REQUEST,
          'INVENTORY_LINE_INVALID',
          'Each inventory line must include a product ID and a positive integer quantity.',
        );
      }
      const nextQuantity = (quantitiesByProductId.get(line.productId) ?? 0) + line.quantity;
      if (!Number.isSafeInteger(nextQuantity) || nextQuantity > MAX_POSTGRES_INTEGER) {
        throw new ApplicationException(
          HttpStatus.BAD_REQUEST,
          'INVENTORY_LINE_INVALID',
          'The requested inventory quantity is too large.',
          { productId: line.productId },
        );
      }
      quantitiesByProductId.set(line.productId, nextQuantity);
    }

    return [...quantitiesByProductId.entries()]
      .sort(([leftProductId], [rightProductId]) => leftProductId.localeCompare(rightProductId))
      .map(([productId, quantity]) => ({ productId, quantity }));
  }

  private stableProductIds(productIds: string[]): string[] {
    return [...new Set(productIds)].sort((left, right) => left.localeCompare(right));
  }

  private normalizeReason(reason: string): string {
    const normalized = reason.trim();
    if (!normalized || normalized.length > 500) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'INVENTORY_REASON_INVALID',
        'An inventory operation requires a non-empty reason of at most 500 characters.',
      );
    }
    return normalized;
  }

  private assertInventoryManager(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.STAFF && actor.role !== UserRole.ADMIN) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_FORBIDDEN',
        'You do not have permission to manage inventory.',
      );
    }
  }

  private throwProductNotFound(): never {
    throw new ApplicationException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }
}
