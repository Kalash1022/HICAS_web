import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/auth-context';
import { ROUTES } from '../../config/routes';

function AuthLoadingScreen() {
  return (
    <main className="auth-loading-page" aria-live="polite">
      <p>Đang kiểm tra phiên đăng nhập…</p>
    </main>
  );
}

export default function RequireAuthentication({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'restoring') {
    return <AuthLoadingScreen />;
  }

  if (status === 'mfa-required') {
    return <Navigate to={ROUTES.mfa} replace state={{ from: location }} />;
  }

  if (status !== 'authenticated') {
    return <Navigate to={ROUTES.login} replace state={{ from: location }} />;
  }

  return children;
}
