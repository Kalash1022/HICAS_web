import EntityFormModal from '../components/forms/EntityFormModal';
import { productFormFields } from '../config/forms';
import { ROUTES } from '../config/routes';

export default function ProductFormPage() {
  return <EntityFormModal title="Tạo mới sản phẩm" fields={productFormFields} returnPath={ROUTES.products} sizeClass="product-modal" />;
}
