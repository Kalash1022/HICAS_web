import { OrderStatus } from '@prisma/client';

export type OrderInventoryOperation = 'commit' | 'release' | 'restock' | null;

export interface OrderTransitionPlan {
  inventoryOperation: OrderInventoryOperation;
  requiresCancellationNote: boolean;
}

const TRANSITIONS: Readonly<Record<string, OrderTransitionPlan>> = {
  [`${OrderStatus.PENDING}:${OrderStatus.CONFIRMED}`]: {
    inventoryOperation: 'commit',
    requiresCancellationNote: false,
  },
  [`${OrderStatus.PENDING}:${OrderStatus.CANCELLED}`]: {
    inventoryOperation: 'release',
    requiresCancellationNote: false,
  },
  [`${OrderStatus.CONFIRMED}:${OrderStatus.PROCESSING}`]: {
    inventoryOperation: null,
    requiresCancellationNote: false,
  },
  [`${OrderStatus.CONFIRMED}:${OrderStatus.CANCELLED}`]: {
    inventoryOperation: 'restock',
    requiresCancellationNote: true,
  },
  [`${OrderStatus.PROCESSING}:${OrderStatus.SHIPPING}`]: {
    inventoryOperation: null,
    requiresCancellationNote: false,
  },
  [`${OrderStatus.PROCESSING}:${OrderStatus.CANCELLED}`]: {
    inventoryOperation: 'restock',
    requiresCancellationNote: true,
  },
  [`${OrderStatus.SHIPPING}:${OrderStatus.COMPLETED}`]: {
    inventoryOperation: null,
    requiresCancellationNote: false,
  },
};

export function getOrderTransitionPlan(
  fromStatus: OrderStatus,
  toStatus: OrderStatus,
): OrderTransitionPlan | null {
  return TRANSITIONS[`${fromStatus}:${toStatus}`] ?? null;
}
