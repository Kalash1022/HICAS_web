import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { getReturnPath } from '../auth/auth-navigation';
import AuthAlert from '../components/auth/AuthAlert';
import BrandLogo from '../components/common/BrandLogo';
import { PrimaryButton } from '../components/common/Buttons';
import FormField from '../components/common/FormField';
import { ROUTES } from '../config/routes';
import { ApiError, getAuthErrorMessage } from '../lib/api';

function stripSpaces(value) {
  return value.replace(/\s/g, '');
}

export default function MfaPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    status,
    pendingMfa,
    beginMfaEnrollment,
    completeMfaEnrollment,
    completeMfaChallenge,
    clearPendingMfa,
  } = useAuth();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const returnTo = getReturnPath(location.state);

  if (status === 'restoring') {
    return (
      <main className="auth-loading-page" aria-live="polite">
        <p>Đang kiểm tra phiên đăng nhập…</p>
      </main>
    );
  }

  if (recoveryCodes.length > 0) {
    return (
      <main className="login-page">
        <section className="login-panel mfa-panel">
          <BrandLogo large />
          <h1>Lưu mã khôi phục</h1>
          <p className="auth-progress-copy">Các mã này chỉ được hiển thị một lần. Hãy lưu ở nơi an toàn.</p>
          <ol className="recovery-codes" aria-label="Mã khôi phục MFA">
            {recoveryCodes.map((recoveryCodeValue) => <li key={recoveryCodeValue}>{recoveryCodeValue}</li>)}
          </ol>
          <PrimaryButton type="button" onClick={() => navigate(returnTo, { replace: true })}>
            Tôi đã lưu các mã này
          </PrimaryButton>
        </section>
      </main>
    );
  }

  if (!pendingMfa || status !== 'mfa-required') {
    return <Navigate to={ROUTES.login} replace />;
  }

  const returnToLogin = () => {
    clearPendingMfa();
    navigate(ROUTES.login, { replace: true });
  };

  const handleCreateSetup = async () => {
    setBusyAction('setup');
    setError('');

    try {
      setSetup(await beginMfaEnrollment());
    } catch (setupError) {
      setError(getAuthErrorMessage(setupError));
    } finally {
      setBusyAction('');
    }
  };

  const handleEnable = async (event) => {
    event.preventDefault();
    const normalisedCode = stripSpaces(code);

    if (!normalisedCode) {
      setError('Nhập mã gồm 6 chữ số từ ứng dụng xác thực.');
      return;
    }

    setBusyAction('enable');
    setError('');

    try {
      const result = await completeMfaEnrollment(normalisedCode);
      setRecoveryCodes(result.recoveryCodes);
      setCode('');
    } catch (enableError) {
      setError(getAuthErrorMessage(enableError));
    } finally {
      setBusyAction('');
    }
  };

  const handleVerify = async (event) => {
    event.preventDefault();
    const value = useRecoveryCode ? stripSpaces(recoveryCode) : stripSpaces(code);

    if (!value) {
      setError(useRecoveryCode ? 'Nhập mã khôi phục.' : 'Nhập mã gồm 6 chữ số từ ứng dụng xác thực.');
      return;
    }

    setBusyAction('verify');
    setError('');

    try {
      await completeMfaChallenge(
        useRecoveryCode ? { recoveryCode: value } : { code: value },
      );
      navigate(returnTo, { replace: true });
    } catch (verificationError) {
      if (
        verificationError instanceof ApiError &&
        ['MFA_CHALLENGE_INVALID', 'MFA_CHALLENGE_EXHAUSTED'].includes(verificationError.code)
      ) {
        clearPendingMfa();
        navigate(ROUTES.login, { replace: true });
        return;
      }
      setError(getAuthErrorMessage(verificationError));
    } finally {
      setBusyAction('');
    }
  };

  if (pendingMfa.type === 'enrollment') {
    return (
      <main className="login-page">
        <section className="login-panel mfa-panel">
          <BrandLogo large />
          <h1>Thiết lập xác thực hai lớp</h1>
          {!setup ? (
            <>
              <p className="auth-progress-copy">Dùng ứng dụng như Google Authenticator để bảo vệ tài khoản quản trị.</p>
              <AuthAlert>{error}</AuthAlert>
              <PrimaryButton type="button" disabled={busyAction === 'setup'} onClick={handleCreateSetup}>
                {busyAction === 'setup' ? 'Đang tạo mã QR…' : 'Tạo mã QR'}
              </PrimaryButton>
              <button className="auth-text-button" type="button" onClick={returnToLogin}>Quay lại đăng nhập</button>
            </>
          ) : (
            <form onSubmit={handleEnable}>
              <p className="auth-progress-copy">Quét mã QR, sau đó nhập mã 6 chữ số đang hiển thị trong ứng dụng.</p>
              <img className="mfa-qr-code" src={setup.qrCodeDataUrl} alt="Mã QR thiết lập xác thực hai lớp" />
              <p className="mfa-manual-key"><strong>Khóa thủ công:</strong> <code>{setup.manualKey}</code></p>
              <FormField
                label="Mã xác thực"
                name="mfa-code"
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
              />
              <AuthAlert>{error}</AuthAlert>
              <PrimaryButton type="submit" disabled={busyAction === 'enable'}>
                {busyAction === 'enable' ? 'Đang xác nhận…' : 'Bật xác thực hai lớp'}
              </PrimaryButton>
              <button className="auth-text-button" type="button" onClick={returnToLogin}>Hủy</button>
            </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <section className="login-panel mfa-panel">
        <BrandLogo large />
        <h1>Xác thực hai lớp</h1>
        <form onSubmit={handleVerify}>
          <p className="auth-progress-copy">
            {useRecoveryCode ? 'Nhập một mã khôi phục chưa sử dụng.' : 'Nhập mã 6 chữ số từ ứng dụng xác thực của bạn.'}
          </p>
          {useRecoveryCode ? (
            <FormField
              label="Mã khôi phục"
              name="recovery-code"
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              autoComplete="one-time-code"
              required
            />
          ) : (
            <FormField
              label="Mã xác thực"
              name="mfa-code"
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
          )}
          <AuthAlert>{error}</AuthAlert>
          <PrimaryButton type="submit" disabled={busyAction === 'verify'}>
            {busyAction === 'verify' ? 'Đang xác thực…' : 'Xác nhận'}
          </PrimaryButton>
          <button
            className="auth-text-button"
            type="button"
            onClick={() => {
              setUseRecoveryCode((value) => !value);
              setError('');
            }}
          >
            {useRecoveryCode ? 'Dùng mã từ ứng dụng xác thực' : 'Dùng mã khôi phục'}
          </button>
          <button className="auth-text-button" type="button" onClick={returnToLogin}>Quay lại đăng nhập</button>
        </form>
      </section>
    </main>
  );
}
