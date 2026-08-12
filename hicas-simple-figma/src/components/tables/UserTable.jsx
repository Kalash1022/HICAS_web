import { formatDate } from '../../utils/formatters.js';

export default function UserTable({ items, loading, error }) {
  const message = error || (loading ? 'Đang tải dữ liệu...' : 'Không có người dùng phù hợp.');
  return (
    <section className="product-card">
      <div className="table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>Họ và tên</th>
              <th>Email</th>
              <th>Vai trò</th>
              <th>Ngày tạo</th>
            </tr>
          </thead>
          <tbody>
            {loading || error || !items.length ? (
              <tr>
                <td className="table-message" colSpan="4">
                  {message}
                </td>
              </tr>
            ) : (
              items.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong className="product-name">{user.fullName}</strong>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <span className="role-badge" data-role={user.role}>
                      {user.role === 'admin' ? 'Quản trị viên' : 'Nhân viên'}
                    </span>
                  </td>
                  <td>{formatDate(user.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
