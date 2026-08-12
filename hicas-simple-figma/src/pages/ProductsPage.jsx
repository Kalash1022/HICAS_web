import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/common/FormField.jsx';
import Modal from '../components/common/Modal.jsx';
import ProductTable from '../components/tables/ProductTable.jsx';

const emptyProduct = {
  name: '',
  price: '',
  quantity: '',
  category: '',
  description: '',
  imageUrl: '',
};

export default function ProductsPage() {
  const [filters, setFilters] = useState({ search: '', minPrice: '', maxPrice: '' });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState(emptyProduct);
  const load = async () => {
    setLoading(true);
    try {
      const payload = await api.listProducts(filters);
      setItems(payload.data);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const timer = setTimeout(load, 180);
    return () => clearTimeout(timer);
  }, [filters.search, filters.minPrice, filters.maxPrice]);
  const updateFilter = (event) =>
    setFilters({ ...filters, [event.target.name]: event.target.value });
  const updateForm = (event) => setForm({ ...form, [event.target.name]: event.target.value });
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api.createProduct({
        ...form,
        price: Number(form.price),
        quantity: Number(form.quantity),
      });
      setForm(emptyProduct);
      setIsOpen(false);
      load();
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h1>Danh sách sản phẩm</h1>
          <p className="result-summary">
            {loading ? 'Đang tải dữ liệu...' : `${items.length} sản phẩm`}
          </p>
        </div>
        <button
          className="button button-primary"
          onClick={() => {
            setError('');
            setIsOpen(true);
          }}
        >
          + Tạo sản phẩm
        </button>
      </div>
      <section className="filter-panel">
        <div className="filter-field filter-field-search">
          <label>Tìm theo tên</label>
          <input name="search" value={filters.search} onChange={updateFilter} type="search" />
        </div>
        <div className="filter-field">
          <label>Giá từ</label>
          <input
            name="minPrice"
            value={filters.minPrice}
            onChange={updateFilter}
            type="number"
            min="0"
          />
        </div>
        <div className="filter-field">
          <label>Giá đến</label>
          <input
            name="maxPrice"
            value={filters.maxPrice}
            onChange={updateFilter}
            type="number"
            min="0"
          />
        </div>
        <button
          className="button button-secondary"
          onClick={() => setFilters({ search: '', minPrice: '', maxPrice: '' })}
        >
          Xóa bộ lọc
        </button>
      </section>
      <ProductTable items={items} loading={loading} error={error} />
      {isOpen && (
        <Modal title="Tạo mới sản phẩm" onClose={() => setIsOpen(false)}>
          <form className="product-form" onSubmit={submit}>
            <div className="dialog-content">
              <FormField
                label="Tên sản phẩm"
                name="name"
                value={form.name}
                onChange={updateForm}
                required
              />
              <div className="form-row">
                <FormField
                  label="Giá"
                  name="price"
                  type="number"
                  value={form.price}
                  onChange={updateForm}
                  required
                />
                <FormField
                  label="Số lượng"
                  name="quantity"
                  type="number"
                  value={form.quantity}
                  onChange={updateForm}
                  required
                />
              </div>
              <FormField
                label="Danh mục"
                name="category"
                value={form.category}
                onChange={updateForm}
              />
              <FormField
                label="Mô tả"
                name="description"
                value={form.description}
                onChange={updateForm}
                multiline
              />
              <FormField
                label="Ảnh sản phẩm (URL)"
                name="imageUrl"
                type="url"
                value={form.imageUrl}
                onChange={updateForm}
              />
              {error && <p className="form-error">{error}</p>}
            </div>
            <DialogFooter onClose={() => setIsOpen(false)} />
          </form>
        </Modal>
      )}
    </section>
  );
}

function DialogFooter({ onClose }) {
  return (
    <div className="dialog-footer">
      <button className="button button-secondary" type="button" onClick={onClose}>
        Hủy
      </button>
      <button className="button button-primary" type="submit">
        Tạo mới
      </button>
    </div>
  );
}
