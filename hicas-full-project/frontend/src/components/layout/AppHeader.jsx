import { Bell, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/auth-context';
import { ROUTES } from '../../config/routes';

function initials(fullName) {
  return (fullName || 'HICAS')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export default function AppHeader({ title }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate(ROUTES.login, { replace: true });
  };

  return (
    <header className="app-header">
      <h1>{title}</h1>
      <div className="profile-actions">
        <div className="notification"><Bell size={24} /><span>4</span></div>
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
            <div className="profile-menu" role="menu">
              <strong>{user?.fullName}</strong>
              <span>{user?.email}</span>
              <button type="button" role="menuitem" onClick={handleSignOut}>
                <LogOut size={16} /> Đăng xuất
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
