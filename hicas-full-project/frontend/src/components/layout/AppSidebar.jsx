import { Box, ClipboardList, Menu, Tags, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/auth-context';
import { ROUTES } from '../../config/routes';
import BrandLogo from '../common/BrandLogo';
import { IconButton } from '../common/Buttons';

const navigationItems = [
  { label: 'Sản phẩm', path: ROUTES.products, icon: Box, roles: ['STAFF', 'ADMIN'] },
  { label: 'Danh mục', path: ROUTES.categories, icon: Tags, roles: ['STAFF', 'ADMIN'] },
  { label: 'Đơn hàng', path: ROUTES.orders, icon: ClipboardList, roles: ['STAFF', 'ADMIN'] },
  { label: 'Users', path: ROUTES.users, icon: Users, roles: ['ADMIN'] },
];

export default function AppSidebar() {
  const { user } = useAuth();
  const visibleNavigationItems = navigationItems.filter((item) => item.roles.includes(user?.role));

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <BrandLogo />
        <IconButton label="Thu gọn menu"><Menu size={21} /></IconButton>
      </div>

      <p className="sidebar-label">QUẢN LÝ SẢN PHẨM</p>
      <nav aria-label="Điều hướng quản lý">
        {visibleNavigationItems.map(({ label, path, icon: Icon }) => (
          <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to={path} key={path}>
            <Icon size={23} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
