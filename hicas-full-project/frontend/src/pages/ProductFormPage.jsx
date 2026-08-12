import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import AuthAlert from '../components/auth/AuthAlert';
import { IconButton, PrimaryButton } from '../components/common/Buttons';
import FormField from '../components/common/FormField';
import SelectField from '../components/common/SelectField';
import { productManagePath, ROUTES } from '../config/routes';
import { apiRequest, getAuthErrorMessage } from '../lib/api';

const EMPTY_FORM = {
  categoryId: '',
  name: '',
  slug: '',
  sku: '',
  price: '',
  description: '',
};

function toSlug(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function ProductFormPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { requestWithAuthentication } = useAuth();
  const isEditing = Boolean(productId);
  const [form, setForm] = useState(EMPTY_FORM);
  const [categories, setCategories] = useState([]);
  const [loadingForm, setLoadingForm] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    const categoriesRequest = apiRequest('categories', { signal: controller.signal });
    const productRequest = isEditing
      ? requestWithAuthentication('admin/products/' + encodeURIComponent(productId), {
          signal: controller.signal,
        })
      : Promise.resolve(null);

    Promise.all([categoriesRequest, productRequest])
      .then(([categoryResult, product]) => {
        if (isCurrent) {
          const categoryList = Array.isArray(categoryResult) ? categoryResult : [];
          const selectedCategoryIsMissing = product && !categoryList.some(
            (category) => category.id === product.category.id,
          );
          setCategories(selectedCategoryIsMissing ? [...categoryList, product.category] : categoryList);

          if (product) {
            setForm({
              categoryId: product.categoryId,
              name: product.name,
              slug: product.slug,
              sku: product.sku,
              price: product.price,
              description: product.description || '',
            });
            setSlugManuallyEdited(true);
          }
        }
      })
      .catch((loadError) => {
        if (isCurrent && loadError?.name !== 'AbortError') {
          setError(getAuthErrorMessage(loadError));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setLoadingForm(false);
        }
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [isEditing, productId, requestWithAuthentication]);

  const updateField = (name, value) => {
    setForm((currentForm) => {
      const nextForm = { ...currentForm, [name]: value };

      if (name === 'name' && !slugManuallyEdited) {
        nextForm.slug = toSlug(value);
      }

      return nextForm;
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.categoryId || !form.name.trim() || !form.slug.trim() || !form.sku.trim() || !form.price.trim()) {
      setError('Nhập danh mục, tên, slug, SKU và giá để lưu sản phẩm.');
      return;
    }

    setSubmitting(true);

    try {
      const savedProduct = await requestWithAuthentication(
        isEditing ? 'admin/products/' + encodeURIComponent(productId) : 'admin/products',
        {
          method: isEditing ? 'PATCH' : 'POST',
          body: {
            categoryId: form.categoryId,
            name: form.name.trim(),
            slug: form.slug.trim(),
            sku: form.sku.trim(),
            price: form.price.trim(),
            description: form.description.trim() || null,
          },
        },
      );
      navigate(isEditing ? ROUTES.products : productManagePath(savedProduct.id), { replace: true });
    } catch (submissionError) {
      setError(getAuthErrorMessage(submissionError));
    } finally {
      setSubmitting(false);
    }
  };

  const isBusy = loadingForm || submitting;
  const categoriesUnavailable = !loadingForm && categories.length === 0;
  const formMessage = error || (
    categoriesUnavailable
      ? 'Chưa có danh mục đang hoạt động. Hãy tạo danh mục trước khi tạo sản phẩm.'
      : ''
  );

  return (
    <main className="modal-stage">
      <section className="entity-modal product-modal product-create-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <h1 id="modal-title">{isEditing ? 'Chỉnh sửa sản phẩm' : 'Tạo mới sản phẩm'}</h1>
          <IconButton label="Đóng" onClick={() => navigate(ROUTES.products)}><X size={20} /></IconButton>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-fields">
            <SelectField
              label="Danh mục *"
              name="categoryId"
              value={form.categoryId}
              onChange={(event) => updateField('categoryId', event.target.value)}
              disabled={isBusy || categories.length === 0}
              required
            >
              <option value="">{loadingForm ? 'Đang tải danh mục…' : 'Chọn danh mục'}</option>
              {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
            </SelectField>
            <FormField
              label="Tên sản phẩm *"
              name="name"
              placeholder="Nhập tên sản phẩm"
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              disabled={isBusy}
              required
            />
            <FormField
              label="Slug *"
              name="slug"
              placeholder="ao-thun-cotton"
              value={form.slug}
              onChange={(event) => {
                setSlugManuallyEdited(true);
                updateField('slug', event.target.value);
              }}
              disabled={isBusy}
              required
            />
            <FormField
              label="SKU *"
              name="sku"
              placeholder="TSHIRT-COTTON-001"
              value={form.sku}
              onChange={(event) => updateField('sku', event.target.value)}
              disabled={isBusy}
              required
            />
            <FormField
              label="Giá *"
              name="price"
              placeholder="199000"
              value={form.price}
              onChange={(event) => updateField('price', event.target.value)}
              inputMode="decimal"
              disabled={isBusy}
              required
            />
            <FormField
              label="Mô tả"
              name="description"
              placeholder="Nhập mô tả"
              multiline
              value={form.description}
              onChange={(event) => updateField('description', event.target.value)}
              disabled={isBusy}
            />
            <p className="form-helper">
              {isEditing
                ? 'Ảnh và tồn kho được quản lý bằng bước riêng để đảm bảo kiểm soát phiên bản tồn kho.'
                : 'Sản phẩm được tạo ở trạng thái nháp. Thêm ảnh và tồn kho trong bước chỉnh sửa tiếp theo.'}
            </p>
            <AuthAlert>{formMessage}</AuthAlert>
          </div>

          <footer className="modal-footer">
            <button className="secondary-button" type="button" onClick={() => navigate(ROUTES.products)} disabled={submitting}>Hủy</button>
            {categoriesUnavailable ? (
              <button className="secondary-button" type="button" onClick={() => navigate(ROUTES.categories)} disabled={submitting}>
                Quản lý danh mục
              </button>
            ) : null}
            {isEditing ? (
              <button className="secondary-button" type="button" onClick={() => navigate(productManagePath(productId))} disabled={submitting}>
                Ảnh &amp; tồn kho
              </button>
            ) : null}
            <PrimaryButton type="submit" disabled={isBusy || categories.length === 0}>
              {submitting ? 'Đang lưu…' : isEditing ? 'Lưu thay đổi' : 'Tạo mới'}
            </PrimaryButton>
          </footer>
        </form>
      </section>
    </main>
  );
}
