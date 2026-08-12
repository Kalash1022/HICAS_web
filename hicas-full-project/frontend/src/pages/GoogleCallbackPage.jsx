import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import {
  clearRememberedReturnPath,
  getRememberedReturnPath,
} from '../auth/auth-navigation';
import AuthAlert from '../components/auth/AuthAlert';
import BrandLogo from '../components/common/BrandLogo';
import { ROUTES } from '../config/routes';
import { ApiError, getAuthErrorMessage } from '../lib/api';

export default function GoogleCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { finishGoogleSignIn } = useAuth();
  const [error, setError] = useState('');
  const callbackRequest = useRef(null);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  useEffect(() => {
    if (!callbackRequest.current) {
      callbackRequest.current = (async () => {
        const returnTo = getRememberedReturnPath();

        try {
          if (!code || !state) {
            throw new ApiError({
              code: 'OAUTH_STATE_COOKIE_MISMATCH',
              message: 'Google không trả về đầy đủ thông tin đăng nhập.',
            });
          }

          const result = await finishGoogleSignIn({ code, state });
          return { result, returnTo };
        } finally {
          clearRememberedReturnPath();
        }
      })();
    }

    let isMounted = true;
    const request = callbackRequest.current;

    request
      .then(({ result, returnTo }) => {
        if (!isMounted) {
          return;
        }
        if (result.kind === 'session') {
          navigate(returnTo, { replace: true });
          return;
        }

        navigate(ROUTES.mfa, { replace: true, state: { returnTo } });
      })
      .catch((callbackError) => {
        if (isMounted) {
          setError(getAuthErrorMessage(callbackError));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [code, finishGoogleSignIn, navigate, state]);

  return (
    <main className="login-page">
      <section className="login-panel auth-progress-panel">
        <BrandLogo large />
        <h1>Đăng nhập với Google</h1>
        {error ? (
          <>
            <AuthAlert>{error}</AuthAlert>
            <Link className="primary-button" to={ROUTES.login}>Quay lại đăng nhập</Link>
          </>
        ) : (
          <p className="auth-progress-copy" role="status">Đang hoàn tất đăng nhập an toàn…</p>
        )}
      </section>
    </main>
  );
}
