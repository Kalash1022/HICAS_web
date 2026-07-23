import { Navigate, Route, Routes } from 'react-router-dom';
import CoverPage from './pages/CoverPage';
import LoginPage from './pages/LoginPage';
import ProductFormPage from './pages/ProductFormPage';
import ProductsPage from './pages/ProductsPage';
import UserFormPage from './pages/UserFormPage';
import UsersPage from './pages/UsersPage';
import NotFoundPage from './pages/NotFoundPage';
import { ROUTES } from './config/routes';

export default function App() {
  return (
    <Routes>
      <Route path={ROUTES.home} element={<Navigate to={ROUTES.products} replace />} />
      <Route path={ROUTES.cover} element={<CoverPage />} />
      <Route path={ROUTES.login} element={<LoginPage />} />
      <Route path={ROUTES.users} element={<UsersPage />} />
      <Route path={ROUTES.createUser} element={<UserFormPage />} />
      <Route path={ROUTES.products} element={<ProductsPage />} />
      <Route path={ROUTES.createProduct} element={<ProductFormPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
