import { Box, LayoutDashboard, LogIn, LogOut, Menu, ReceiptText, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/auth-context';
import { useCart } from '../../cart/cart-context';
import { ROUTES } from '../../config/routes';
import BrandLogo from '../common/BrandLogo';

function canAccessAdmin(user) {
  return user?.role === 'STAFF' || user?.role === 'ADMIN';
}

function initials(fullName) {
  return (fullName || 'HICAS')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export default function StorefrontLayout({ children, title = 'Cửa hàng' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, user, signOut } = useAuth();
  const { cart, loading: cartLoading } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const returnTo = location.pathname + location.search + location.hash;
  const isAuthenticated = status === 'authenticated';
  const itemCount = isAuthenticated && !cartLoading ? cart.itemCount : 0;

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate(ROUTES.shop, { replace: true });
  };

  return (
    <div className="dashboard-page storefront-page">
      <aside className="sidebar storefront-sidebar">
        <div className="sidebar-top">
          <Link className="storefront-sidebar-brand" to={ROUTES.shop} aria-label="HICAS Store">
            <BrandLogo />
          </Link>
          <span className="storefront-sidebar-menu" aria-hidden="true"><Menu size={21} /></span>
        </div>

        <p className="sidebar-label">CỬA HÀNG</p>
        <nav aria-label="Điều hướng cửa hàng">
          <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to={ROUTES.shop}>
            <Box size={23} />
            <span>Sản phẩm</span>
          </NavLink>
          <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to={ROUTES.cart} end>
            <ShoppingCart size={23} />
            <span>Giỏ hàng</span>
            {itemCount > 0 ? <b className="storefront-nav-count">{itemCount}</b> : null}
          </NavLink>
          {isAuthenticated ? (
            <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to={ROUTES.myOrders}>
              <ReceiptText size={23} />
              <span>Đơn mua</span>
            </NavLink>
          ) : null}
        </nav>

        {canAccessAdmin(user) ? (
          <div className="storefront-admin-navigation">
            <p className="sidebar-label">QUẢN TRỊ</p>
            <Link className="nav-item" to={ROUTES.products}>
              <LayoutDashboard size={23} />
              <span>Quản lý</span>
            </Link>
          </div>
        ) : null}
      </aside>

      <main className="dashboard-main storefront-main">
        <header className="app-header storefront-app-header">
          <h1>{title}</h1>
          <div className="profile-actions">
            <Link className="notification storefront-header-cart" to={ROUTES.cart} aria-label={`Giỏ hàng${itemCount ? `, ${itemCount} sản phẩm` : ''}`}>
              <ShoppingCart size={23} />
              {itemCount > 0 ? <span>{itemCount}</span> : null}
            </Link>
            {isAuthenticated ? (
              <div className="profile-menu-wrapper">
                <button
                  className="profile-placeholder"
                  type="button"
                  aria-label="Mở menu tài khoản"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((isOpen) => !isOpen)}
                >
                  {initials(user?.fullName)}
                </button>
                {menuOpen ? (
                  <div className="profile-menu storefront-profile-menu" role="menu">
                    <strong>{user?.fullName || 'Tài khoản HICAS'}</strong>
                    <span>{user?.email}</span>
                    <Link role="menuitem" to={ROUTES.myOrders} onClick={() => setMenuOpen(false)}>
                      <ReceiptText size={16} /> Đơn mua
                    </Link>
                    {canAccessAdmin(user) ? (
                      <Link role="menuitem" to={ROUTES.products} onClick={() => setMenuOpen(false)}>
                        <LayoutDashboard size={16} /> Quản trị
                      </Link>
                    ) : null}
                    <button type="button" role="menuitem" onClick={handleSignOut}>
                      <LogOut size={16} /> Đăng xuất
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <Link className="primary-button storefront-header-login" to={ROUTES.login} state={{ returnTo }}>
                <LogIn size={16} /> Đăng nhập
              </Link>
            )}
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
