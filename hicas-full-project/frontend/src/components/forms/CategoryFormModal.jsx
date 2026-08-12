import { useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../../auth/auth-context';
import AuthAlert from '../auth/AuthAlert';
import { IconButton, PrimaryButton } from '../common/Buttons';
import FormField from '../common/FormField';
import SelectField from '../common/SelectField';
import { adminApi } from '../../lib/admin-api';
import { getAuthErrorMessage } from '../../lib/api';

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

function createInitialForm(category) {
  return {
    name: category?.name || '',
    slug: category?.slug || '',
    description: category?.description || '',
    sortOrder: String(category?.sortOrder ?? 0),
    isActive: category?.isActive ?? true,
  };
}

export default function CategoryFormModal({ category, onClose, onSaved }) {
  const { requestWithAuthentication } = useAuth();
  const isEditing = Boolean(category);
  const [form, setForm] = useState(() => createInitialForm(category));
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(isEditing);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
    const sortOrder = Number(form.sortOrder);

    if (!form.name.trim() || !form.slug.trim()) {
      setError('Nhập tên và slug danh mục để lưu.');
      return;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      setError('Thứ tự hiển thị phải là số nguyên từ 0 trở lên.');
      return;
    }

    setSubmitting(true);
    setError('');

    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      description: form.description.trim(),
      sortOrder,
      isActive: form.isActive,
    };

    try {
      const savedCategory = isEditing
        ? await adminApi.updateCategory(requestWithAuthentication, category.id, payload)
        : await adminApi.createCategory(requestWithAuthentication, payload);
      onSaved(savedCategory);
    } catch (submissionError) {
      setError(getAuthErrorMessage(submissionError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="modal-stage">
      <section className="entity-modal category-modal" role="dialog" aria-modal="true" aria-labelledby="category-modal-title">
        <header className="modal-header">
          <h1 id="category-modal-title">{isEditing ? 'Chỉnh sửa danh mục' : 'Tạo mới danh mục'}</h1>
          <IconButton label="Đóng" onClick={onClose} disabled={submitting}><X size={20} /></IconButton>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-fields">
            <FormField
              label="Tên danh mục *"
              name="name"
              placeholder="Ví dụ: Áo thun"
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              disabled={submitting}
              required
            />
            <FormField
              label="Slug *"
              name="slug"
              placeholder="ao-thun"
              value={form.slug}
              onChange={(event) => {
                setSlugManuallyEdited(true);
                updateField('slug', event.target.value);
              }}
              disabled={submitting}
              required
            />
            <FormField
              label="Mô tả"
              name="description"
              placeholder="Mô tả ngắn về danh mục"
              multiline
              value={form.description}
              onChange={(event) => updateField('description', event.target.value)}
              disabled={submitting}
            />
            <FormField
              label="Thứ tự hiển thị"
              name="sortOrder"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={form.sortOrder}
              onChange={(event) => updateField('sortOrder', event.target.value)}
              disabled={submitting}
            />
            <SelectField
              label="Trạng thái"
              value={String(form.isActive)}
              onChange={(event) => updateField('isActive', event.target.value === 'true')}
              disabled={submitting}
            >
              <option value="true">Hoạt động</option>
              <option value="false">Tạm dừng</option>
            </SelectField>
            <AuthAlert>{error}</AuthAlert>
          </div>

          <footer className="modal-footer">
            <button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>Hủy</button>
            <PrimaryButton type="submit" disabled={submitting}>
              {submitting ? 'Đang lưu…' : isEditing ? 'Lưu thay đổi' : 'Tạo mới'}
            </PrimaryButton>
          </footer>
        </form>
      </section>
    </main>
  );
}
