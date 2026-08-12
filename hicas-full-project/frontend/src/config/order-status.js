export const ORDER_STATUS_LABELS = Object.freeze({
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  PROCESSING: 'Đang xử lý',
  SHIPPING: 'Đang giao',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
});

export const ORDER_STATUS_FILTERS = Object.freeze([
  { value: '', label: 'Tất cả trạng thái' },
  ...Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label })),
]);

const TRANSITIONS = Object.freeze({
  PENDING: [
    { status: 'CONFIRMED', label: 'Xác nhận đơn' },
    { status: 'CANCELLED', label: 'Hủy đơn', requiresNote: false },
  ],
  CONFIRMED: [
    { status: 'PROCESSING', label: 'Bắt đầu xử lý' },
    { status: 'CANCELLED', label: 'Hủy & hoàn tồn', requiresNote: true },
  ],
  PROCESSING: [
    { status: 'SHIPPING', label: 'Bàn giao vận chuyển' },
    { status: 'CANCELLED', label: 'Hủy & hoàn tồn', requiresNote: true },
  ],
  SHIPPING: [
    { status: 'COMPLETED', label: 'Hoàn tất đơn' },
  ],
});

export function getOrderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status || '—';
}

export function getOrderTransitions(status) {
  return TRANSITIONS[status] || [];
}
