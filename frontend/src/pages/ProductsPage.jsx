import AppShell from '../components/layout/AppShell';
import ProductTable from '../components/tables/ProductTable';
import { ROUTES } from '../config/routes';

export default function ProductsPage() {
  return (
    <AppShell title="Danh sách sản phẩm" createPath={ROUTES.createProduct}>
      <ProductTable />
    </AppShell>
  );
}
