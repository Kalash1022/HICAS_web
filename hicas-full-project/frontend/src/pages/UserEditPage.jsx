import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import AuthAlert from '../components/auth/AuthAlert';
import { IconButton, PrimaryButton } from '../components/common/Buttons';
import FormField from '../components/common/FormField';
import SelectField from '../components/common/SelectField';
import StatusBadge from '../components/common/StatusBadge';
import { ROUTES } from '../config/routes';
import { adminApi } from '../lib/admin-api';
import { getAuthErrorMessage } from '../lib/api';

const EMPTY_DRAFT = { role: '', status: '' };

export default function UserEditPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser, requestWithAuthentication } = useAuth();
  const [managedUser, setManagedUser] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resettingMfa, setResettingMfa] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const isCurrentUser = managedUser?.id === currentUser?.id;

  useEffect(() => {
    let isCurrent = true;

    adminApi.getUser(requestWithAuthentication, userId)
      .then((result) => {
        if (!isCurrent) {
          return;
        }
        setManagedUser(result);
        setDraft({ role: result.role, status: result.status });
      })
      .catch((requestError) => {
        if (isCurrent) {
          setError(getAuthErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [requestWithAuthentication, userId]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!managedUser) {
      return;
    }
    if (isCurrentUser) {
      setError('Bạn không thể tự thay đổi vai trò hoặc trạng thái tài khoản. Hãy nhờ một quản trị viên khác thực hiện thao tác này.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      let updatedUser = managedUser;

      if (draft.role !== managedUser.role) {
        updatedUser = await adminApi.updateUserRole(requestWithAuthentication, userId, draft.role);
      }

      if (draft.status !== updatedUser.status) {
        updatedUser = await adminApi.updateUserStatus(requestWithAuthentication, userId, draft.status);
      }

      setManagedUser(updatedUser);
      setDraft({ role: updatedUser.role, status: updatedUser.status });
      setSuccessMessage('Đã cập nhật tài khoản. Các phiên cũ của người dùng đã được thu hồi khi cần thiết.');
    } catch (updateError) {
      setError(getAuthErrorMessage(updateError));
    } finally {
      setSaving(false);
    }
  };

  const handleResetMfa = async () => {
    if (!managedUser || managedUser.id === currentUser?.id) {
      return;
    }

    const confirmed = window.confirm(
      'Đặt lại MFA sẽ đăng xuất người dùng và buộc họ thiết lập lại ở lần đăng nhập sau. Tiếp tục?',
    );
    if (!confirmed) {
      return;
    }

    setResettingMfa(true);
    setError('');
    setSuccessMessage('');

    try {
      const updatedUser = await adminApi.resetUserMfa(requestWithAuthentication, userId);
      setManagedUser(updatedUser);
      setSuccessMessage('Đã đặt lại MFA. Người dùng sẽ thiết lập lại MFA ở lần đăng nhập tiếp theo.');
    } catch (resetError) {
      setError(getAuthErrorMessage(resetError));
    } finally {
      setResettingMfa(false);
    }
  };

  return (
    <main className="modal-stage">
      <section className="entity-modal user-edit-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <h1 id="modal-title">Quản lý người dùng</h1>
          <IconButton label="Đóng" onClick={() => navigate(ROUTES.users)}><X size={20} /></IconButton>
        </header>

        {loading ? (
          <div className="modal-state">Đang tải người dùng…</div>
        ) : error && !managedUser ? (
          <div className="modal-state">
            <AuthAlert>{error}</AuthAlert>
            <button className="secondary-button" type="button" onClick={() => navigate(ROUTES.users)}>Quay lại</button>
          </div>
        ) : managedUser ? (
          <form onSubmit={handleSubmit}>
            <div className="modal-fields">
              <FormField label="Tên người dùng" value={managedUser.fullName} disabled />
              <FormField label="Email" type="email" value={managedUser.email} disabled />
              <SelectField
                label="Vai trò"
                value={draft.role}
                disabled={saving || resettingMfa || isCurrentUser}
                onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, role: event.target.value }))}
              >
                <option value="CUSTOMER">Khách hàng</option>
                <option value="STAFF">Nhân viên</option>
                <option value="ADMIN">Quản trị viên</option>
              </SelectField>
              <SelectField
                label="Trạng thái tài khoản"
                value={draft.status}
                disabled={saving || resettingMfa || isCurrentUser}
                onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, status: event.target.value }))}
              >
                {managedUser.status === 'PENDING' ? <option value="PENDING" disabled>Chờ kích hoạt</option> : null}
                <option value="ACTIVE">Hoạt động</option>
                <option value="BLOCKED">Đã khóa</option>
              </SelectField>
              <div className="form-field">
                <span>Trạng thái MFA</span>
                <div className="field-control"><StatusBadge status={managedUser.mfaStatus} /></div>
              </div>
              {managedUser.id !== currentUser?.id && managedUser.role !== 'CUSTOMER' ? (
                <button className="secondary-button user-mfa-reset" type="button" disabled={saving || resettingMfa} onClick={handleResetMfa}>
                  {resettingMfa ? 'Đang đặt lại MFA…' : 'Đặt lại MFA'}
                </button>
              ) : null}
              {isCurrentUser ? (
                <p className="form-helper">Để tránh thu hồi phiên đang dùng, một quản trị viên khác phải thay đổi vai trò hoặc trạng thái của bạn.</p>
              ) : null}
              <AuthAlert>{error}</AuthAlert>
              {successMessage ? <p className="form-success" role="status">{successMessage}</p> : null}
            </div>

            <footer className="modal-footer">
              <button className="secondary-button" type="button" disabled={saving || resettingMfa} onClick={() => navigate(ROUTES.users)}>Hủy</button>
              <PrimaryButton type="submit" disabled={saving || resettingMfa || isCurrentUser}>
                {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
              </PrimaryButton>
            </footer>
          </form>
        ) : null}
      </section>
    </main>
  );
}
