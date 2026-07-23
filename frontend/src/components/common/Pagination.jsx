import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_NUMBERS = [1, 2, 3, 4, 5];

export default function Pagination() {
  return (
    <footer className="table-footer">
      <div className="page-size">
        <span>Showing</span>
        <button type="button">10 <ChevronDown size={16} /></button>
        <span>of 50</span>
      </div>

      <nav className="pagination" aria-label="Phân trang">
        <button type="button" aria-label="Trang trước"><ChevronLeft size={16} /></button>
        {PAGE_NUMBERS.map((page) => (
          <button className={page === 1 ? 'active' : ''} type="button" key={page}>{page}</button>
        ))}
        <button type="button" aria-label="Trang sau"><ChevronRight size={16} /></button>
      </nav>
    </footer>
  );
}
