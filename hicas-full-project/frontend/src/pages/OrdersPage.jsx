import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import OrderListToolbar from '../components/orders/OrderListToolbar';
import AppShell from '../components/layout/AppShell';
import OrderTable from '../components/tables/OrderTable';
import { orderDetailPath } from '../config/routes';
import usePaginatedList from '../hooks/usePaginatedList';
import { adminApi } from '../lib/admin-api';
import { getAuthErrorMessage } from '../lib/api';

const PAGE_LIMIT = 10;

export default function OrdersPage() {
  const { requestWithAuthentication } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const queryParameters = useMemo(() => (status ? { status } : {}), [status]);
  const loadOrders = useCallback(
    (parameters) => adminApi.listOrders(requestWithAuthentication, parameters),
    [requestWithAuthentication],
  );
  const { items, pagination, loading, error, retry } = usePaginatedList({
    loadPage: loadOrders,
    page,
    limit: PAGE_LIMIT,
    search: undefined,
    queryParameters,
  });

  return (
    <AppShell
      title="Quản lý đơn hàng"
      toolbar={<OrderListToolbar status={status} onStatusChange={(value) => {
        setStatus(value);
        setPage(1);
      }} />}
    >
      <OrderTable
        orders={items}
        pagination={pagination}
        loading={loading}
        error={error ? getAuthErrorMessage(error) : ''}
        onRetry={retry}
        onPageChange={setPage}
        onView={(order) => navigate(orderDetailPath(order.id))}
      />
    </AppShell>
  );
}
