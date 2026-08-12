import { Plus, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PrimaryButton } from '../common/Buttons';

export default function ListToolbar({
  createPath,
  onCreate,
  createDisabled = false,
  createDisabledLabel = '',
  searchValue = '',
  onSearchChange,
}) {
  const navigate = useNavigate();
  const hasCreateAction = Boolean(createPath || onCreate);

  const handleCreate = () => {
    if (onCreate) {
      onCreate();
      return;
    }

    if (createPath) {
      navigate(createPath);
    }
  };

  return (
    <section className="list-toolbar" aria-label="Công cụ danh sách">
      <label className="search-input">
        <span className="sr-only">Tìm kiếm</span>
        <input
          type="search"
          placeholder="Tìm kiếm"
          value={searchValue}
          onChange={(event) => onSearchChange?.(event.target.value)}
        />
        <Search size={21} />
      </label>

      <span title={createDisabled ? createDisabledLabel : undefined}>
        <PrimaryButton disabled={createDisabled || !hasCreateAction} onClick={handleCreate}>
          <Plus size={18} /> Tạo mới
        </PrimaryButton>
      </span>
    </section>
  );
}
