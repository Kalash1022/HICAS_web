import { useCallback, useState } from 'react';
import { useAuth } from '../auth/auth-context';
import AuthAlert from '../components/auth/AuthAlert';
import CategoryFormModal from '../components/forms/CategoryFormModal';
import AppShell from '../components/layout/AppShell';
import CategoryTable from '../components/tables/CategoryTable';
import useDebouncedValue from '../hooks/useDebouncedValue';
import usePaginatedList from '../hooks/usePaginatedList';
import { adminApi } from '../lib/admin-api';
import { getAuthErrorMessage } from '../lib/api';

const PAGE_LIMIT = 10;

export default function CategoriesPage() {
  const { requestWithAuthentication } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [formState, setFormState] = useState(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState('');
  const [actionError, setActionError] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const loadCategories = useCallback(
    (parameters) => adminApi.listCategories(requestWithAuthentication, parameters),
    [requestWithAuthentication],
  );
  const { items, pagination, loading, error, retry } = usePaginatedList({
    loadPage: loadCategories,
    page,
    limit: PAGE_LIMIT,
    search: debouncedSearch,
  });

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const handleDelete = async (category) => {
    const confirmed = window.confirm(
      `Xóa danh mục “${category.name}”? Chỉ danh mục chưa có sản phẩm mới có thể bị xóa.`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingCategoryId(category.id);
    setActionError('');

    try {
      await adminApi.deleteCategory(requestWithAuthentication, category.id);
      if (items.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        retry();
      }
    } catch (deletionError) {
      setActionError(getAuthErrorMessage(deletionError));
    } finally {
      setDeletingCategoryId('');
    }
  };

  const handleSaved = () => {
    setFormState(null);
    setActionError('');
    retry();
  };

  return (
    <>
      <AppShell
        title="Danh mục sản phẩm"
        onCreate={() => {
          setActionError('');
          setFormState({ category: null });
        }}
        searchValue={search}
        onSearchChange={handleSearchChange}
      >
        {actionError ? <div className="table-action-error"><AuthAlert>{actionError}</AuthAlert></div> : null}
        <CategoryTable
          categories={items}
          pagination={pagination}
          loading={loading}
          error={error ? getAuthErrorMessage(error) : ''}
          onRetry={retry}
          onPageChange={setPage}
          deletingCategoryId={deletingCategoryId}
          onEdit={(category) => {
            setActionError('');
            setFormState({ category });
          }}
          onDelete={handleDelete}
        />
      </AppShell>
      {formState ? (
        <CategoryFormModal
          category={formState.category}
          onClose={() => setFormState(null)}
          onSaved={handleSaved}
          key={formState.category?.id || 'create'}
        />
      ) : null}
    </>
  );
}
