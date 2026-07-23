import { Box, Menu, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { ROUTES } from '../../config/routes';
import BrandLogo from '../common/BrandLogo';
import { IconButton } from '../common/Buttons';

const navigationItems = [
  { label: 'Sản phẩm', path: ROUTES.products, icon: Box },
  { label: 'Users', path: ROUTES.users, icon: Users },
];

export default function AppSidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <BrandLogo />
        <IconButton label="Thu gọn menu"><Menu size={21} /></IconButton>
      </div>

      <p className="sidebar-label">QUẢN LÝ SẢN PHẨM</p>
      <nav aria-label="Điều hướng quản lý">
        {navigationItems.map(({ label, path, icon: Icon }) => (
          <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to={path} key={path}>
            <Icon size={23} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
