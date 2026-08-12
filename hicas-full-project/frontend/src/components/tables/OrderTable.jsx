import { Eye } from 'lucide-react';
import { IconButton } from '../common/Buttons';
import Pagination from '../common/Pagination';
import StatusBadge from '../common/StatusBadge';
import { getOrderStatusLabel } from '../../config/order-status';
import TableHeader from './TableHeader';

const columns = ['Mã đơn', 'Khách hàng', 'Sản phẩm', 'Tổng tiền', 'Trạng thái', 'Ngày tạo', 'Hành động'];

function formatMoney(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '—';
  }

  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: currency || 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function OrderRow({ order, onView }) {
  return (
    <div className="table-row" role="row">
      <div className="name-cell" role="cell" title={order.orderNumber}>{order.orderNumber}</div>
      <div role="cell" title={order.customer.email}>
        <strong className="table-primary-copy">{order.customer.fullName}</strong>
        <span className="table-secondary-copy">{order.customer.email}</span>
      </div>
      <div role="cell">{order.itemCount} sản phẩm</div>
      <div role="cell">{formatMoney(order.totalAmount, order.currency)}</div>
      <div role="cell"><StatusBadge status={order.status} label={getOrderStatusLabel(order.status)} /></div>
      <div role="cell">{formatDateTime(order.createdAt)}</div>
      <div role="cell">
        <IconButton label={`Xem đơn ${order.orderNumber}`} onClick={() => onView(order)}>
          <Eye size={20} />
        </IconButton>
      </div>
    </div>
  );
}

function TableState({ loading, error, hasItems, onRetry }) {
  if (hasItems) {
    return null;
  }
  if (loading) {
    return <div className="table-row table-state" role="row"><div role="cell">Đang tải đơn hàng…</div></div>;
  }
  if (error) {
    return (
      <div className="table-row table-state" role="row">
        <div role="cell">
          <div>Không thể tải danh sách đơn hàng. {error}</div>
          <button className="secondary-button" type="button" onClick={onRetry}>Thử lại</button>
        </div>
      </div>
    );
  }
  return <div className="table-row table-state" role="row"><div role="cell">Không có đơn hàng phù hợp.</div></div>;
}

export default function OrderTable({
  orders,
  pagination,
  loading,
  error,
  onRetry,
  onPageChange,
  onView,
}) {
  return (
    <div className="table-card" aria-busy={loading}>
      <div className="data-table order-table" role="table" aria-label="Danh sách đơn hàng">
        <TableHeader columns={columns} />
        {orders.map((order) => <OrderRow order={order} onView={onView} key={order.id} />)}
        <TableState loading={loading} error={error} hasItems={orders.length > 0} onRetry={onRetry} />
      </div>
      <Pagination {...pagination} onPageChange={onPageChange} />
    </div>
  );
}
