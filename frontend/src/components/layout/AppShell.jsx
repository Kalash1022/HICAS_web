import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';
import ListToolbar from './ListToolbar';

export default function AppShell({ title, createPath, children }) {
  return (
    <div className="dashboard-page">
      <AppSidebar />
      <main className="dashboard-main">
        <AppHeader title={title} />
        <ListToolbar createPath={createPath} />
        {children}
      </main>
    </div>
  );
}
