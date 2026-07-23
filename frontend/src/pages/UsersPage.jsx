import AppShell from '../components/layout/AppShell';
import UserTable from '../components/tables/UserTable';
import { ROUTES } from '../config/routes';

export default function UsersPage() {
  return (
    <AppShell title="Danh sách người dùng" createPath={ROUTES.createUser}>
      <UserTable />
    </AppShell>
  );
}
