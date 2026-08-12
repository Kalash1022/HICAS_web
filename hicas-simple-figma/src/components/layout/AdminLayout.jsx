export default function AdminLayout({ page, user, onNavigate, onLogout, children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand brand-button" onClick={() => onNavigate('cover')}>
          <img className="brand-logo" src="/HICAS.png" alt="HICAS" />
        </button>
        <nav className="navigation">
          <button
            className={'nav-item ' + (page === 'products' ? 'is-active' : '')}
            onClick={() => onNavigate('products')}
          >
            <span className="nav-glyph">▦</span>
            <span>Sản phẩm</span>
          </button>
          <button
            className={'nav-item ' + (page === 'users' ? 'is-active' : '')}
            onClick={() => onNavigate('users')}
          >
            <span className="nav-glyph">♙</span>
            <span>Người dùng</span>
          </button>
        </nav>
        <div className="sidebar-user">
          <strong>{user?.fullName}</strong>
          <span>{user?.role === 'admin' ? 'Quản trị viên' : 'Nhân viên'}</span>
          <button className="sidebar-logout" onClick={onLogout}>
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <p className="topbar-label">
            {page === 'products' ? 'QUẢN LÝ SẢN PHẨM' : 'QUẢN LÝ NGƯỜI DÙNG'}
          </p>
          <span className="connection-status">PostgreSQL local</span>
        </header>
        {children}
      </main>
    </div>
  );
}
