import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import UserTable from '../components/tables/UserTable';
import AppShell from '../components/layout/AppShell';
import { ROUTES, userEditPath } from '../config/routes';
import useDebouncedValue from '../hooks/useDebouncedValue';
import usePaginatedList from '../hooks/usePaginatedList';
import { adminApi } from '../lib/admin-api';
import { getAuthErrorMessage } from '../lib/api';

const PAGE_LIMIT = 10;

export default function UsersPage() {
  const { requestWithAuthentication } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const loadUsers = useCallback(
    (parameters) => adminApi.listUsers(requestWithAuthentication, parameters),
    [requestWithAuthentication],
  );
  const { items, pagination, loading, error, retry } = usePaginatedList({
    loadPage: loadUsers,
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
      title="Danh sách người dùng"
      createPath={ROUTES.createUser}
      createDisabled
      createDisabledLabel="Lean MVP dùng đăng ký tự phục vụ; chưa có API mời tài khoản."
      searchValue={search}
      onSearchChange={handleSearchChange}
    >
      <UserTable
        users={items}
        pagination={pagination}
        loading={loading}
        error={error ? getAuthErrorMessage(error) : ''}
        onRetry={retry}
        onPageChange={setPage}
        onEdit={(user) => navigate(userEditPath(user.id))}
      />
    </AppShell>
  );
}
