import EntityFormModal from '../components/forms/EntityFormModal';
import { userFormFields } from '../config/forms';
import { ROUTES } from '../config/routes';

export default function UserFormPage() {
  return (
    <EntityFormModal
      title="Tạo mới người dùng"
      fields={userFormFields}
      returnPath={ROUTES.users}
      sizeClass="user-modal"
      submitDisabled
      submitLabel="Chưa khả dụng"
      unavailableNotice="Cần API mời tài khoản."
    />
  );
}
