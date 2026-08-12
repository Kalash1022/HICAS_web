import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';
import ListToolbar from './ListToolbar';

export default function AppShell({
  title,
  createPath,
  onCreate,
  createDisabled,
  createDisabledLabel,
  searchValue,
  onSearchChange,
  toolbar,
  children,
}) {
  return (
    <div className="dashboard-page">
      <AppSidebar />
      <main className="dashboard-main">
        <AppHeader title={title} />
        {toolbar === undefined ? (
          <ListToolbar
            createPath={createPath}
            onCreate={onCreate}
            createDisabled={createDisabled}
            createDisabledLabel={createDisabledLabel}
            searchValue={searchValue}
            onSearchChange={onSearchChange}
          />
        ) : toolbar}
        {children}
      </main>
    </div>
  );
}
