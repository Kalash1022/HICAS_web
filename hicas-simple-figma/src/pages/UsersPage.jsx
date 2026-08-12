import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/common/FormField.jsx';
import Modal from '../components/common/Modal.jsx';
import UserTable from '../components/tables/UserTable.jsx';

const emptyUser = { fullName: '', email: '', password: '', role: 'staff' };

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState(emptyUser);
  const load = async () => {
    setLoading(true);
    try {
      const payload = await api.listUsers(search);
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
  }, [search]);
  const updateForm = (event) => setForm({ ...form, [event.target.name]: event.target.value });
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api.createUser(form);
      setForm(emptyUser);
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
          <h1>Danh sách người dùng</h1>
          <p className="result-summary">
            {loading ? 'Đang tải dữ liệu...' : `${items.length} người dùng`}
          </p>
        </div>
        <button
          className="button button-primary"
          onClick={() => {
            setError('');
            setIsOpen(true);
          }}
        >
          + Tạo người dùng
        </button>
      </div>
      <section className="filter-panel">
        <div className="filter-field filter-field-search">
          <label>Tìm theo tên hoặc email</label>
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" />
        </div>
        <button className="button button-secondary" onClick={() => setSearch('')}>
          Xóa bộ lọc
        </button>
      </section>
      <UserTable items={items} loading={loading} error={error} />
      {isOpen && (
        <Modal title="Tạo mới người dùng" onClose={() => setIsOpen(false)}>
          <form className="product-form" onSubmit={submit}>
            <div className="dialog-content">
              <FormField
                label="Họ và tên"
                name="fullName"
                value={form.fullName}
                onChange={updateForm}
                required
              />
              <FormField
                label="Email"
                name="email"
                type="email"
                value={form.email}
                onChange={updateForm}
                required
              />
              <FormField
                label="Mật khẩu"
                name="password"
                type="password"
                value={form.password}
                onChange={updateForm}
                required
              />
              <div className="form-field">
                <label>Vai trò</label>
                <select name="role" value={form.role} onChange={updateForm}>
                  <option value="staff">Nhân viên</option>
                  <option value="admin">Quản trị viên</option>
                </select>
              </div>
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
