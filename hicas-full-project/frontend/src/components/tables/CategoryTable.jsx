import Pagination from '../common/Pagination';
import RowActions from '../common/RowActions';
import StatusBadge from '../common/StatusBadge';
import TableHeader from './TableHeader';

const columns = ['Tên danh mục', 'Slug', 'Mô tả', 'Thứ tự', 'Trạng thái', 'Hành động'];

function CategoryRow({ category, deleting, onEdit, onDelete }) {
  return (
    <div className="table-row" role="row">
      <div className="name-cell" role="cell" title={category.name}>{category.name}</div>
      <div role="cell" title={category.slug}>{category.slug}</div>
      <div role="cell" title={category.description || ''}>{category.description || '—'}</div>
      <div role="cell">{category.sortOrder}</div>
      <div role="cell"><StatusBadge status={category.isActive ? 'ACTIVE' : 'INACTIVE'} /></div>
      <div role="cell">
        {deleting ? (
          <span className="table-action-progress">Đang xóa…</span>
        ) : (
          <RowActions
            entityName={category.name}
            onEdit={() => onEdit(category)}
            onDelete={() => onDelete(category)}
          />
        )}
      </div>
    </div>
  );
}

function TableState({ loading, error, hasItems, onRetry }) {
  if (hasItems) {
    return null;
  }

  if (loading) {
    return <div className="table-row table-state" role="row"><div role="cell">Đang tải danh mục…</div></div>;
  }

  if (error) {
    return (
      <div className="table-row table-state" role="row">
        <div role="cell">
          <div>Không thể tải danh sách danh mục. {error}</div>
          <button className="secondary-button" type="button" onClick={onRetry}>Thử lại</button>
        </div>
      </div>
    );
  }

  return <div className="table-row table-state" role="row"><div role="cell">Chưa có danh mục nào.</div></div>;
}

export default function CategoryTable({
  categories,
  pagination,
  loading,
  error,
  onRetry,
  onPageChange,
  deletingCategoryId,
  onEdit,
  onDelete,
}) {
  return (
    <div className="table-card" aria-busy={loading || Boolean(deletingCategoryId)}>
      <div className="data-table category-table" role="table" aria-label="Danh sách danh mục">
        <TableHeader columns={columns} />
        {categories.map((category) => (
          <CategoryRow
            category={category}
            deleting={category.id === deletingCategoryId}
            onEdit={onEdit}
            onDelete={onDelete}
            key={category.id}
          />
        ))}
        <TableState loading={loading} error={error} hasItems={categories.length > 0} onRetry={onRetry} />
      </div>
      <Pagination {...pagination} onPageChange={onPageChange} />
    </div>
  );
}
