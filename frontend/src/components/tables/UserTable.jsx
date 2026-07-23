import { users } from '../../data/mockData';
import Pagination from '../common/Pagination';
import RowActions from '../common/RowActions';
import TableHeader from './TableHeader';

const columns = ['Avatar', 'Tên người dùng', 'Email', 'Ngày sinh', 'Số điện thoại', 'Hành động'];

function UserRow({ user }) {
  const imagePath = `/assets/users/${encodeURIComponent(user.image)}`;

  return (
    <div className="table-row" role="row">
      <div role="cell"><img className="avatar-image" src={imagePath} alt={`Avatar của ${user.name}`} /></div>
      <div className="name-cell" role="cell">{user.name}</div>
      <div role="cell">{user.email}</div>
      <div role="cell">{user.birthDate}</div>
      <div role="cell">{user.phone}</div>
      <div role="cell"><RowActions entityName={user.name} /></div>
    </div>
  );
}

export default function UserTable() {
  return (
    <div className="table-card">
      <div className="data-table user-table" role="table" aria-label="Danh sách người dùng">
        <TableHeader columns={columns} />
        {users.map((user) => <UserRow user={user} key={user.id} />)}
      </div>
      <Pagination />
    </div>
  );
}
