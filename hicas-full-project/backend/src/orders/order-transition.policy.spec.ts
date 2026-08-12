import { OrderStatus } from '@prisma/client';

import { getOrderTransitionPlan } from './order-transition.policy';

describe('order transition policy', () => {
  it.each([
    [OrderStatus.PENDING, OrderStatus.CONFIRMED, 'commit', false],
    [OrderStatus.PENDING, OrderStatus.CANCELLED, 'release', false],
    [OrderStatus.CONFIRMED, OrderStatus.PROCESSING, null, false],
    [OrderStatus.CONFIRMED, OrderStatus.CANCELLED, 'restock', true],
    [OrderStatus.PROCESSING, OrderStatus.SHIPPING, null, false],
    [OrderStatus.PROCESSING, OrderStatus.CANCELLED, 'restock', true],
    [OrderStatus.SHIPPING, OrderStatus.COMPLETED, null, false],
  ])(
    'allows %s to %s with %s inventory operation',
    (fromStatus, toStatus, inventoryOperation, requiresCancellationNote) => {
      expect(getOrderTransitionPlan(fromStatus, toStatus)).toEqual({
        inventoryOperation,
        requiresCancellationNote,
      });
    },
  );

  it('rejects skips, reverse transitions, and terminal state changes', () => {
    expect(getOrderTransitionPlan(OrderStatus.PENDING, OrderStatus.PROCESSING)).toBeNull();
    expect(getOrderTransitionPlan(OrderStatus.COMPLETED, OrderStatus.CANCELLED)).toBeNull();
    expect(getOrderTransitionPlan(OrderStatus.CANCELLED, OrderStatus.PENDING)).toBeNull();
  });
});
