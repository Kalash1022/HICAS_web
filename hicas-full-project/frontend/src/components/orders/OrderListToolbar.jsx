import { Filter } from 'lucide-react';
import { ORDER_STATUS_FILTERS } from '../../config/order-status';

export default function OrderListToolbar({ status, onStatusChange }) {
  return (
    <section className="list-toolbar order-list-toolbar" aria-label="Lọc đơn hàng">
      <label className="order-status-filter">
        <Filter size={18} />
        <span>Trạng thái</span>
        <select value={status} onChange={(event) => onStatusChange(event.target.value)}>
          {ORDER_STATUS_FILTERS.map((option) => (
            <option value={option.value} key={option.value || 'all'}>{option.label}</option>
          ))}
        </select>
      </label>
    </section>
  );
}
