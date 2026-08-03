import { Injectable } from '@nestjs/common';
import { AuditAction, InventoryTransactionType, Prisma } from '@prisma/client';

import type { RequestContext } from '../auth/auth.types';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import { DatabaseService } from '../database/database.service';
import type { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import type { ListInventoryTransactionsQueryDto } from './dto/list-inventory-transactions-query.dto';
import type {
  InventoryAdjustmentMutationResult,
  InventoryMutation,
  InventoryOperationContext,
  InventorySnapshot,
  InventoryTransactionListResult,
  LockedInventory,
} from './inventory.types';

interface InventoryStateRecord {
  productId: string;
  quantity: number;
  reservedQuantity: number;
  version: number;
  updatedAt: Date;
}

@Injectable()
export class InventoryRepository {
  constructor(private readonly database: DatabaseService) {}

  async listTransactions(
    productId: string,
    query: ListInventoryTransactionsQueryDto,
  ): Promise<InventoryTransactionListResult> {
    const [inventory, transactions, total] = await this.database.$transaction([
      this.database.inventory.findFirst({
        where: { productId, product: { is: { deletedAt: null } } },
        select: { productId: true },
      }),
      this.database.inventoryTransaction.findMany({
        where: { productId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.database.inventoryTransaction.count({ where: { productId } }),
    ]);

    if (!inventory) {
      return { kind: 'not-found' };
    }

    const result: PaginatedResult<(typeof transactions)[number]> = {
      data: transactions,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
    return { kind: 'found', result };
  }

  async adjust(input: {
    actorId: string;
    productId: string;
    dto: CreateInventoryAdjustmentDto;
    request: RequestContext;
    requestId: string;
  }): Promise<InventoryAdjustmentMutationResult> {
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.inventory.findFirst({
        where: { productId: input.productId, product: { is: { deletedAt: null } } },
        select: this.inventoryStateSelect(),
      });
      if (!current) {
        return { kind: 'not-found' };
      }
      if (current.version !== input.dto.expectedVersion) {
        return { kind: 'version-conflict', currentVersion: current.version };
      }

      const quantityAfter = current.quantity + input.dto.quantityDelta;
      if (quantityAfter < current.reservedQuantity) {
        return {
          kind: 'invalid-adjustment',
          quantity: current.quantity,
          reservedQuantity: current.reservedQuantity,
          requestedDelta: input.dto.quantityDelta,
        };
      }

      const update = await transaction.inventory.updateMany({
        where: {
          productId: input.productId,
          version: input.dto.expectedVersion,
        },
        data: {
          quantity: quantityAfter,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) {
        return { kind: 'version-conflict', currentVersion: current.version };
      }

      const updated = await transaction.inventory.findUnique({
        where: { productId: input.productId },
        select: this.inventoryStateSelect(),
      });
      if (!updated) {
        return { kind: 'not-found' };
      }

      const ledgerEntry = await transaction.inventoryTransaction.create({
        data: {
          productId: input.productId,
          type: InventoryTransactionType.ADJUST,
          quantityDelta: input.dto.quantityDelta,
          reservedDelta: 0,
          quantityAfter: updated.quantity,
          reservedAfter: updated.reservedQuantity,
          reason: input.dto.reason,
          createdById: input.actorId,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          action: AuditAction.INVENTORY_ADJUSTED,
          entityType: 'INVENTORY',
          entityId: input.productId,
          beforeData: this.inventoryAuditSnapshot(current),
          afterData: {
            ...this.inventoryAuditSnapshot(updated),
            quantityDelta: input.dto.quantityDelta,
            reservedDelta: 0,
            reason: input.dto.reason,
          },
          ipAddress: input.request.ipAddress,
          requestId: input.requestId,
        },
      });

      return {
        kind: 'updated',
        result: {
          inventory: this.toSnapshot(updated),
          transaction: ledgerEntry,
        },
      };
    });
  }

  /**
   * Locks every requested inventory row in ascending product-ID order. Callers
   * must keep using the provided transaction until their Order operation ends.
   */
  lockForProducts(
    transaction: Prisma.TransactionClient,
    productIds: string[],
  ): Promise<LockedInventory[]> {
    const stableProductIds = [...new Set(productIds)].sort((left, right) =>
      left.localeCompare(right),
    );
    if (stableProductIds.length === 0) {
      return Promise.resolve([]);
    }

    const ids = Prisma.join(stableProductIds.map((productId) => Prisma.sql`${productId}::uuid`));
    return transaction.$queryRaw<LockedInventory[]>(Prisma.sql`
      SELECT
        product_id AS "productId",
        quantity,
        reserved_quantity AS "reservedQuantity",
        version
      FROM inventory
      WHERE product_id IN (${ids})
      ORDER BY product_id
      FOR UPDATE
    `);
  }

  async applyMutations(
    transaction: Prisma.TransactionClient,
    input: { mutations: InventoryMutation[]; context: InventoryOperationContext },
  ): Promise<InventorySnapshot[]> {
    const snapshots: InventorySnapshot[] = [];
    for (const mutation of input.mutations) {
      const updated = await transaction.inventory.update({
        where: { productId: mutation.productId },
        data: {
          quantity: mutation.quantityAfter,
          reservedQuantity: mutation.reservedAfter,
          version: { increment: 1 },
        },
        select: this.inventoryStateSelect(),
      });
      await transaction.inventoryTransaction.create({
        data: {
          productId: mutation.productId,
          orderId: input.context.orderId ?? null,
          type: mutation.type,
          quantityDelta: mutation.quantityDelta,
          reservedDelta: mutation.reservedDelta,
          quantityAfter: updated.quantity,
          reservedAfter: updated.reservedQuantity,
          reason: input.context.reason,
          createdById: input.context.createdById ?? null,
        },
      });
      snapshots.push(this.toSnapshot(updated));
    }
    return snapshots;
  }

  private inventoryStateSelect() {
    return {
      productId: true,
      quantity: true,
      reservedQuantity: true,
      version: true,
      updatedAt: true,
    } satisfies Prisma.InventorySelect;
  }

  private inventoryAuditSnapshot(inventory: InventoryStateRecord): Prisma.InputJsonObject {
    return {
      productId: inventory.productId,
      quantity: inventory.quantity,
      reservedQuantity: inventory.reservedQuantity,
      availableQuantity: inventory.quantity - inventory.reservedQuantity,
      version: inventory.version,
    };
  }

  private toSnapshot(inventory: InventoryStateRecord): InventorySnapshot {
    return {
      productId: inventory.productId,
      quantity: inventory.quantity,
      reservedQuantity: inventory.reservedQuantity,
      availableQuantity: inventory.quantity - inventory.reservedQuantity,
      version: inventory.version,
      updatedAt: inventory.updatedAt,
    };
  }
}
