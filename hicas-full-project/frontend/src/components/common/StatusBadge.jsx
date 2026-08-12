const labels = {
  ACTIVE: 'Hoạt động',
  PENDING: 'Chờ kích hoạt',
  BLOCKED: 'Đã khóa',
  ENABLED: 'Đã bật MFA',
  NONE: 'Chưa bật MFA',
  DRAFT: 'Nháp',
  ARCHIVED: 'Đã lưu trữ',
  INACTIVE: 'Tạm dừng',
  CONFIRMED: 'Đã xác nhận',
  PROCESSING: 'Đang xử lý',
  SHIPPING: 'Đang giao',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
  UNPAID: 'Chưa thanh toán',
  PAID: 'Đã thanh toán',
};

export default function StatusBadge({ status, label }) {
  const statusKey = String(status || 'UNKNOWN').toLowerCase();

  return (
    <span className={'status-badge status-badge--' + statusKey}>
      {label || labels[status] || status || '—'}
    </span>
  );
}
