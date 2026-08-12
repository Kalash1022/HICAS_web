import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { ROUTES } from '../config/routes';

export default function AccessDeniedPage() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate(ROUTES.login, { replace: true });
  };

  return (
    <main className="not-found-page access-denied-page">
      <section>
        <p>403</p>
        <h1>Tài khoản không có quyền truy cập khu vực quản trị</h1>
        <button className="primary-button" type="button" onClick={handleSignOut}>
          Đăng xuất
        </button>
      </section>
    </main>
  );
}
