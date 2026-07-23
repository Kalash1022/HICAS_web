import { EyeOff } from 'lucide-react';
import BrandLogo from '../components/common/BrandLogo';
import { PrimaryButton } from '../components/common/Buttons';
import FormField from '../components/common/FormField';

export default function LoginPage() {
  const handleSubmit = (event) => event.preventDefault();

  return (
    <main className="login-page">
      <section className="login-panel">
        <BrandLogo large />
        <form onSubmit={handleSubmit}>
          <h1>Đăng nhập</h1>
          <FormField label="Email" placeholder="Nhập email" type="email" />
          <FormField label="Mật khẩu" placeholder="••••••••••••••" type="password" icon={<EyeOff size={19} />} />

          <div className="login-options">
            <label><input type="checkbox" /> Ghi nhớ Đăng nhập</label>
            <a href="#forgot">Quên mật khẩu?</a>
          </div>

          <PrimaryButton type="submit">Đăng nhập</PrimaryButton>
          <p className="register-copy">Bạn chưa có tài khoản? <a href="#register">Đăng ký</a></p>
        </form>
      </section>
    </main>
  );
}
