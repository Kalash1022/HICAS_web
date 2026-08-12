import { useState } from 'react';
import Pagination from '../common/Pagination';
import RowActions from '../common/RowActions';
import TableHeader from './TableHeader';

const columns = ['Avatar', 'Tên người dùng', 'Email', 'Ngày sinh', 'Số điện thoại', 'Hành động'];

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'U';
}

function Avatar({ url, name }) {
  const [unavailable, setUnavailable] = useState(false);

  if (!url || unavailable) {
    return <div className="avatar-fallback" aria-label={`Avatar của ${name}`}>{initials(name)}</div>;
  }

  return <img className="avatar-image" src={url} alt={`Avatar của ${name}`} onError={() => setUnavailable(true)} />;
}

function formatBirthDate(value) {
  if (!value) {
    return '—';
  }

  const isoDate = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return isoDate ? `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}` : '—';
}

function UserRow({ user, onEdit }) {
  return (
    <div className="table-row" role="row">
      <div role="cell"><Avatar url={user.avatarUrl} name={user.fullName} /></div>
      <div className="name-cell" role="cell" title={user.fullName}>{user.fullName}</div>
      <div role="cell" title={user.email}>{user.email}</div>
      <div role="cell">{formatBirthDate(user.birthDate)}</div>
      <div role="cell" title={user.phone || ''}>{user.phone || '—'}</div>
      <div role="cell"><RowActions entityName={user.fullName} onEdit={onEdit ? () => onEdit(user) : undefined} /></div>
    </div>
  );
}

function TableState({ loading, error, hasItems, onRetry }) {
  if (hasItems) {
    return null;
  }

  if (loading) {
    return <div className="table-row table-state" role="row"><div role="cell">Đang tải người dùng…</div></div>;
  }

  if (error) {
    return (
      <div className="table-row table-state" role="row">
        <div role="cell">
          <div>Không thể tải danh sách người dùng. {error}</div>
          <button className="secondary-button" type="button" onClick={onRetry}>Thử lại</button>
        </div>
      </div>
    );
  }

  return <div className="table-row table-state" role="row"><div role="cell">Không tìm thấy người dùng phù hợp.</div></div>;
}

export default function UserTable({
  users,
  pagination,
  loading,
  error,
  onRetry,
  onPageChange,
  onEdit,
}) {
  return (
    <div className="table-card" aria-busy={loading}>
      <div className="data-table user-table" role="table" aria-label="Danh sách người dùng">
        <TableHeader columns={columns} />
        {users.map((user) => <UserRow user={user} onEdit={onEdit} key={user.id} />)}
        <TableState loading={loading} error={error} hasItems={users.length > 0} onRetry={onRetry} />
      </div>
      <Pagination {...pagination} onPageChange={onPageChange} />
    </div>
  );
}
