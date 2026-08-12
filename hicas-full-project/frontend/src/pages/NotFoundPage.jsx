import { Link } from 'react-router-dom';
import { ROUTES } from '../config/routes';

export default function NotFoundPage() {
  return (
    <main className="not-found-page">
      <section>
        <p>404</p>
        <h1>Không tìm thấy trang</h1>
        <Link className="primary-button" to={ROUTES.shop}>Về cửa hàng</Link>
      </section>
    </main>
  );
}
