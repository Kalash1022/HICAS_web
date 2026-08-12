import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { CartProvider } from './cart/CartContext';
import RequireAuthentication from './components/routing/RequireAuthentication';
import RequireRole from './components/routing/RequireRole';
import CoverPage from './pages/CoverPage';
import AccessDeniedPage from './pages/AccessDeniedPage';
import CategoriesPage from './pages/CategoriesPage';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import OrderDetailPage from './pages/OrderDetailPage';
import OrdersPage from './pages/OrdersPage';
import GoogleCallbackPage from './pages/GoogleCallbackPage';
import LoginPage from './pages/LoginPage';
import MfaPage from './pages/MfaPage';
import MyOrderDetailPage from './pages/MyOrderDetailPage';
import MyOrdersPage from './pages/MyOrdersPage';
import ProductFormPage from './pages/ProductFormPage';
import ProductManagementPage from './pages/ProductManagementPage';
import ProductsPage from './pages/ProductsPage';
import ShopPage from './pages/ShopPage';
import ShopProductDetailPage from './pages/ShopProductDetailPage';
import UserFormPage from './pages/UserFormPage';
import UserEditPage from './pages/UserEditPage';
import UsersPage from './pages/UsersPage';
import NotFoundPage from './pages/NotFoundPage';
import { ROUTES } from './config/routes';

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <Routes>
          <Route path={ROUTES.home} element={<Navigate to={ROUTES.shop} replace />} />
          <Route path={ROUTES.cover} element={<CoverPage />} />
          <Route path={ROUTES.shop} element={<ShopPage />} />
          <Route path={ROUTES.shopProduct} element={<ShopProductDetailPage />} />
          <Route path={ROUTES.cart} element={<RequireAuthentication><CartPage /></RequireAuthentication>} />
          <Route path={ROUTES.checkout} element={<RequireAuthentication><CheckoutPage /></RequireAuthentication>} />
          <Route path={ROUTES.myOrders} element={<RequireAuthentication><MyOrdersPage /></RequireAuthentication>} />
          <Route path={ROUTES.myOrderDetail} element={<RequireAuthentication><MyOrderDetailPage /></RequireAuthentication>} />
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route path={ROUTES.googleCallback} element={<GoogleCallbackPage />} />
          <Route path={ROUTES.mfa} element={<MfaPage />} />
          <Route path={ROUTES.forbidden} element={<AccessDeniedPage />} />
          <Route
            path={ROUTES.users}
            element={<RequireRole allowedRoles={['ADMIN']}><UsersPage /></RequireRole>}
          />
          <Route
            path={ROUTES.createUser}
            element={<RequireRole allowedRoles={['ADMIN']}><UserFormPage /></RequireRole>}
          />
          <Route
            path={ROUTES.editUser}
            element={<RequireRole allowedRoles={['ADMIN']}><UserEditPage /></RequireRole>}
          />
          <Route
            path={ROUTES.products}
            element={<RequireRole allowedRoles={['STAFF', 'ADMIN']}><ProductsPage /></RequireRole>}
          />
          <Route
            path={ROUTES.categories}
            element={<RequireRole allowedRoles={['STAFF', 'ADMIN']}><CategoriesPage /></RequireRole>}
          />
          <Route
            path={ROUTES.orders}
            element={<RequireRole allowedRoles={['STAFF', 'ADMIN']}><OrdersPage /></RequireRole>}
          />
          <Route
            path={ROUTES.orderDetail}
            element={<RequireRole allowedRoles={['STAFF', 'ADMIN']}><OrderDetailPage /></RequireRole>}
          />
          <Route
            path={ROUTES.createProduct}
            element={<RequireRole allowedRoles={['STAFF', 'ADMIN']}><ProductFormPage /></RequireRole>}
          />
          <Route
            path={ROUTES.editProduct}
            element={<RequireRole allowedRoles={['STAFF', 'ADMIN']}><ProductFormPage /></RequireRole>}
          />
          <Route
            path={ROUTES.manageProduct}
            element={<RequireRole allowedRoles={['STAFF', 'ADMIN']}><ProductManagementPage /></RequireRole>}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </CartProvider>
    </AuthProvider>
  );
}
