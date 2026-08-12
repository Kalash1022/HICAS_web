import { ChevronRight, PackageSearch } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import Pagination from '../components/common/Pagination';
import StatusBadge from '../components/common/StatusBadge';
import StorefrontLayout from '../components/storefront/StorefrontLayout';
import { getOrderStatusLabel, ORDER_STATUS_FILTERS } from '../config/order-status';
import { myOrderDetailPath, ROUTES } from '../config/routes';
import usePaginatedList from '../hooks/usePaginatedList';
import { getAuthErrorMessage } from '../lib/api';
import { customerApi } from '../lib/customer-api';
import { formatStorefrontPrice } from '../components/storefront/price';

const PAGE_LIMIT = 10;

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

export default function MyOrdersPage() {
  const { requestWithAuthentication } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const queryParameters = useMemo(() => (status ? { status } : {}), [status]);
  const loadOrders = useCallback(
    (parameters) => customerApi.listOrders(requestWithAuthentication, parameters),
    [requestWithAuthentication],
  );
  const { items, pagination, loading, error, retry } = usePaginatedList({
    loadPage: loadOrders,
    page,
    limit: PAGE_LIMIT,
    search: undefined,
    queryParameters,
  });

  const changeStatus = (event) => {
    setStatus(event.target.value);
    setPage(1);
  };

  return (
    <StorefrontLayout title="Đơn mua">
      <section className="storefront-container my-orders-page">
        <header className="my-orders-page__heading">
          <div>
            <p className="shop-eyebrow">ĐƠN MUA</p>
            <h2>Đơn hàng của bạn</h2>
          </div>
          <label className="my-orders-filter">
            <span>Trạng thái</span>
            <select value={status} onChange={changeStatus}>
              {ORDER_STATUS_FILTERS.map((filter) => <option value={filter.value} key={filter.value}>{filter.label}</option>)}
            </select>
          </label>
        </header>

        {items.length === 0 ? (
          <div className="my-orders-state" role={error ? 'alert' : undefined}>
            <PackageSearch size={34} aria-hidden="true" />
            <h2>{loading ? 'Đang tải đơn hàng…' : error ? 'Không thể tải đơn hàng' : 'Bạn chưa có đơn hàng nào'}</h2>
            <p>{error ? getAuthErrorMessage(error) : loading ? 'Vui lòng chờ trong giây lát.' : 'Các đơn hàng đã xác nhận sẽ xuất hiện tại đây.'}</p>
            {error ? <button className="secondary-button" type="button" onClick={retry}>Thử lại</button> : <Link className="primary-button" to={ROUTES.shop}>Khám phá sản phẩm</Link>}
          </div>
        ) : (
          <div className="my-orders-list" aria-busy={loading}>
            {items.map((order) => (
              <article className="my-order-card" key={order.id}>
                <div className="my-order-card__main">
                  <div>
                    <p>Mã đơn hàng</p>
                    <h2>{order.orderNumber}</h2>
                    <time dateTime={order.createdAt}>{formatDateTime(order.createdAt)}</time>
                  </div>
                  <StatusBadge status={order.status} label={getOrderStatusLabel(order.status)} />
                </div>
                <div className="my-order-card__summary">
                  <span>{order.itemCount} sản phẩm</span>
                  <span>{order.paymentMethod === 'COD' ? 'Thanh toán khi nhận hàng' : order.paymentMethod}</span>
                  <strong>{formatStorefrontPrice(order.totalAmount)}</strong>
                </div>
                <Link className="my-order-card__link" to={myOrderDetailPath(order.orderNumber)}>Xem chi tiết <ChevronRight size={17} /></Link>
              </article>
            ))}
          </div>
        )}

        {items.length > 0 ? <div className="my-orders-pagination"><Pagination {...pagination} onPageChange={setPage} /></div> : null}
      </section>
    </StorefrontLayout>
  );
}
