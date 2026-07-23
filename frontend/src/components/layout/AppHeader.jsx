import { Bell } from 'lucide-react';

export default function AppHeader({ title }) {
  return (
    <header className="app-header">
      <h1>{title}</h1>
      <div className="profile-actions">
        <div className="notification"><Bell size={24} /><span>4</span></div>
        <div className="profile-placeholder" aria-label="Ảnh đại diện mẫu">HA</div>
      </div>
    </header>
  );
}
