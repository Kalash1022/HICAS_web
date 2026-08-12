import { useState } from 'react';
import Pagination from '../common/Pagination';
import RowActions from '../common/RowActions';
import TableHeader from './TableHeader';

const columns = ['Tên sản phẩm', 'Giá', 'Số lượng', 'Mô tả', 'Ảnh', 'Hành động'];
const currencyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 2,
});

function formatPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) ? currencyFormatter.format(price) : '—';
}

function ProductImage({ url, name }) {
  const [unavailable, setUnavailable] = useState(false);

  if (!url || unavailable) {
    return <div className="table-image-placeholder" aria-label={`Chưa có ảnh ${name}`}>—</div>;
  }

  return (
    <img
      className="product-image"
      src={url}
      alt={`Ảnh ${name}`}
      onError={() => setUnavailable(true)}
    />
  );
}

function ProductRow({ product, onEdit }) {
  return (
    <div className="table-row" role="row">
      <div className="name-cell" role="cell" title={product.name}>{product.name}</div>
      <div role="cell">{formatPrice(product.price)}</div>
      <div role="cell">{product.inventory?.quantity ?? 0}</div>
      <div role="cell" title={product.description || ''}>{product.description || '—'}</div>
      <div role="cell"><ProductImage url={product.primaryImage?.url} name={product.name} /></div>
      <div role="cell"><RowActions entityName={product.name} onEdit={onEdit ? () => onEdit(product) : undefined} /></div>
    </div>
  );
}

function TableState({ loading, error, hasItems, onRetry }) {
  if (hasItems) {
    return null;
  }

  if (loading) {
    return <div className="table-row table-state" role="row"><div role="cell">Đang tải sản phẩm…</div></div>;
  }

  if (error) {
    return (
      <div className="table-row table-state" role="row">
        <div role="cell">
          <div>Không thể tải danh sách sản phẩm. {error}</div>
          <button className="secondary-button" type="button" onClick={onRetry}>Thử lại</button>
        </div>
      </div>
    );
  }

  return <div className="table-row table-state" role="row"><div role="cell">Không tìm thấy sản phẩm phù hợp.</div></div>;
}

export default function ProductTable({
  products,
  pagination,
  loading,
  error,
  onRetry,
  onPageChange,
  onEdit,
}) {
  return (
    <div className="table-card" aria-busy={loading}>
      <div className="data-table product-table" role="table" aria-label="Danh sách sản phẩm">
        <TableHeader columns={columns} />
        {products.map((product) => <ProductRow product={product} onEdit={onEdit} key={product.id} />)}
        <TableState loading={loading} error={error} hasItems={products.length > 0} onRetry={onRetry} />
      </div>
      <Pagination {...pagination} onPageChange={onPageChange} />
    </div>
  );
}
