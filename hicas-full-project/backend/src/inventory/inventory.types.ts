import type { InventoryTransaction, InventoryTransactionType } from '@prisma/client';

import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';

export interface InventorySnapshot {
  productId: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  version: number;
  updatedAt: Date;
}

export interface InventoryAdjustmentResult {
  inventory: InventorySnapshot;
  transaction: InventoryTransaction;
}

export type InventoryAdjustmentMutationResult =
  | { kind: 'not-found' }
  | { kind: 'version-conflict'; currentVersion: number }
  | {
      kind: 'invalid-adjustment';
      quantity: number;
      reservedQuantity: number;
      requestedDelta: number;
    }
  | { kind: 'updated'; result: InventoryAdjustmentResult };

export type InventoryTransactionListResult =
  { kind: 'not-found' } | { kind: 'found'; result: PaginatedResult<InventoryTransaction> };

export interface InventoryQuantityLine {
  productId: string;
  quantity: number;
}

export interface InventoryOperationContext {
  orderId?: string;
  reason: string;
  createdById?: string;
}

export interface LockedInventory {
  productId: string;
  quantity: number;
  reservedQuantity: number;
  version: number;
}

export interface InventoryMutation {
  productId: string;
  type: InventoryTransactionType;
  quantityDelta: number;
  reservedDelta: number;
  quantityAfter: number;
  reservedAfter: number;
}
