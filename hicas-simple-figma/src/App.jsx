import { useState } from 'react';
import AdminLayout from './components/layout/AdminLayout.jsx';
import CoverPage from './pages/CoverPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ProductsPage from './pages/ProductsPage.jsx';
import UsersPage from './pages/UsersPage.jsx';

const protectedPages = new Set(['products', 'users']);

function initialPage() {
  const page = location.hash.replace('#', '');
  return ['login', 'products', 'users'].includes(page) ? page : 'cover';
}

function getStoredUser() {
  try {
    return JSON.parse(sessionStorage.getItem('hicas-user'));
  } catch {
    return null;
  }
}

export default function App() {
  const [page, setPage] = useState(initialPage);
  const [user, setUser] = useState(getStoredUser);

  const navigate = (nextPage) => {
    const destination = protectedPages.has(nextPage) && !user ? 'login' : nextPage;
    location.hash = destination === 'cover' ? '' : destination;
    setPage(destination);
  };

  const login = (nextUser) => {
    sessionStorage.setItem('hicas-user', JSON.stringify(nextUser));
    setUser(nextUser);
    navigate('products');
  };

  const logout = () => {
    sessionStorage.removeItem('hicas-user');
    setUser(null);
    navigate('cover');
  };

  if (page === 'cover') return <CoverPage user={user} onNavigate={navigate} />;
  if (page === 'login') return <LoginPage onBack={() => navigate('cover')} onLogin={login} />;

  return (
    <AdminLayout page={page} user={user} onNavigate={navigate} onLogout={logout}>
      {page === 'products' ? <ProductsPage /> : <UsersPage />}
    </AdminLayout>
  );
}
