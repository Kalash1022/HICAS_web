import { useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/common/FormField.jsx';

export default function LoginPage({ onBack, onLogin }) {
  const [form, setForm] = useState({ email: 'admin@hicas.local', password: 'Admin@123' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const update = (event) => setForm({ ...form, [event.target.name]: event.target.value });
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = await api.login(form);
      onLogin(payload.data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="login-page">
      <button className="login-brand" onClick={onBack}>
        <img className="brand-logo" src="/HICAS.png" alt="HICAS" />
      </button>
      <section className="login-card">
        <p className="cover-kicker">CHÀO MỪNG TRỞ LẠI</p>
        <h1>Đăng nhập</h1>
        <p className="login-copy">Dùng tài khoản quản trị hoặc nhân viên để tiếp tục.</p>
        <form onSubmit={submit}>
          <FormField
            label="Email"
            name="email"
            type="email"
            value={form.email}
            onChange={update}
            required
          />
          <FormField
            label="Mật khẩu"
            name="password"
            type="password"
            value={form.password}
            onChange={update}
            required
          />
          {error && <p className="form-error">{error}</p>}
          <button
            className="button button-primary login-submit"
            disabled={submitting}
            type="submit"
          >
            {submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>
        <div className="demo-account">
          <strong>Tài khoản demo</strong>
          <span>Admin: admin@hicas.local / Admin@123</span>
          <span>Nhân viên: minh.anh@hicas.local / Demo@123</span>
        </div>
      </section>
    </main>
  );
}
