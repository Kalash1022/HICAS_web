import { Plus, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PrimaryButton } from '../common/Buttons';

export default function ListToolbar({ createPath }) {
  const navigate = useNavigate();

  return (
    <section className="list-toolbar" aria-label="Công cụ danh sách">
      <label className="search-input">
        <span className="sr-only">Tìm kiếm</span>
        <input type="search" placeholder="Tìm kiếm" />
        <Search size={21} />
      </label>

      <PrimaryButton onClick={() => navigate(createPath)}>
        <Plus size={18} /> Tạo mới
      </PrimaryButton>
    </section>
  );
}
