import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import ProductTable from '../components/tables/ProductTable';
import AppShell from '../components/layout/AppShell';
import { productEditPath, ROUTES } from '../config/routes';
import useDebouncedValue from '../hooks/useDebouncedValue';
import usePaginatedList from '../hooks/usePaginatedList';
import { adminApi } from '../lib/admin-api';
import { getAuthErrorMessage } from '../lib/api';

const PAGE_LIMIT = 10;

export default function ProductsPage() {
  const { requestWithAuthentication } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const loadProducts = useCallback(
    (parameters) => adminApi.listProducts(requestWithAuthentication, parameters),
    [requestWithAuthentication],
  );
  const { items, pagination, loading, error, retry } = usePaginatedList({
    loadPage: loadProducts,
    page,
    limit: PAGE_LIMIT,
    search: debouncedSearch,
  });

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  return (
    <AppShell
      title="Danh sách sản phẩm"
      createPath={ROUTES.createProduct}
      searchValue={search}
      onSearchChange={handleSearchChange}
    >
      <ProductTable
        products={items}
        pagination={pagination}
        loading={loading}
        error={error ? getAuthErrorMessage(error) : ''}
        onRetry={retry}
        onPageChange={setPage}
        onEdit={(product) => navigate(productEditPath(product.id))}
      />
    </AppShell>
  );
}
