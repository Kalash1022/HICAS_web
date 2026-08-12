import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { getReturnPath, rememberReturnPath } from '../auth/auth-navigation';
import AuthAlert from '../components/auth/AuthAlert';
import GoogleSignInButton from '../components/auth/GoogleSignInButton';
import BrandLogo from '../components/common/BrandLogo';
import { IconButton, PrimaryButton } from '../components/common/Buttons';
import FormField from '../components/common/FormField';
import { ROUTES } from '../config/routes';
import { getAuthErrorMessage } from '../lib/api';

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, signIn, startGoogleSignIn } = useAuth();
  const returnTo = getReturnPath(location.state);
  const [email, setEmail] = useState(() => window.localStorage.getItem('hicas.remembered.email') || '');
  const [password, setPassword] = useState('');
  const [rememberEmail, setRememberEmail] = useState(() => Boolean(window.localStorage.getItem('hicas.remembered.email')));
  const [showPassword, setShowPassword] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'authenticated') {
      navigate(returnTo, { replace: true });
    }
  }, [navigate, returnTo, status]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (status === 'restoring') {
      return;
    }

    if (!email.trim() || !password) {
      setError('Nhập email và mật khẩu để tiếp tục.');
      return;
    }

    setBusyAction('password');

    try {
      const result = await signIn({ email: email.trim(), password });

      if (rememberEmail) {
        window.localStorage.setItem('hicas.remembered.email', email.trim());
      } else {
        window.localStorage.removeItem('hicas.remembered.email');
      }

      if (result.kind === 'session') {
        navigate(returnTo, { replace: true });
        return;
      }

      navigate(ROUTES.mfa, { replace: true, state: { returnTo } });
    } catch (loginError) {
      setError(getAuthErrorMessage(loginError));
    } finally {
      setBusyAction('');
    }
  };

  const handleGoogleSignIn = async () => {
    if (status === 'restoring') {
      return;
    }

    setError('');
    setBusyAction('google');
    rememberReturnPath(returnTo);

    try {
      await startGoogleSignIn();
    } catch (googleError) {
      setError(getAuthErrorMessage(googleError));
      setBusyAction('');
    }
  };

  const isBusy = Boolean(busyAction) || status === 'restoring';

  return (
    <main className="login-page">
      <section className="login-panel">
        <BrandLogo large />
        <form onSubmit={handleSubmit} noValidate>
          <h1>Đăng nhập</h1>
          <AuthAlert>{error}</AuthAlert>
          <FormField
            label="Email"
            name="email"
            placeholder="Nhập email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            disabled={isBusy}
            required
          />
          <FormField
            label="Mật khẩu"
            name="password"
            placeholder="••••••••••••••"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={isBusy}
            required
            icon={(
              <IconButton
                label={showPassword ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                disabled={isBusy}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </IconButton>
            )}
          />

          <div className="login-options">
            <label><input type="checkbox" checked={rememberEmail} onChange={(event) => setRememberEmail(event.target.checked)} disabled={isBusy} /> Ghi nhớ email</label>
            <a href="#forgot">Quên mật khẩu?</a>
          </div>

          <PrimaryButton type="submit" disabled={isBusy}>
            {busyAction === 'password' ? 'Đang đăng nhập…' : status === 'restoring' ? 'Đang kiểm tra phiên…' : 'Đăng nhập'}
          </PrimaryButton>
          <div className="auth-social-login">
            <div className="auth-divider"><span>hoặc</span></div>
            <GoogleSignInButton disabled={isBusy} onClick={handleGoogleSignIn} />
          </div>
          <p className="register-copy">Bạn chưa có tài khoản? <a href="#register">Đăng ký</a></p>
        </form>
      </section>
    </main>
  );
}
