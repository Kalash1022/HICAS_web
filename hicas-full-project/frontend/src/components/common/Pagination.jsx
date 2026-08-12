import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

function getPageNumbers(page, totalPages) {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export default function Pagination({
  page = 1,
  limit = 10,
  total = 0,
  totalPages = 1,
  onPageChange,
}) {
  const pageNumbers = getPageNumbers(page, totalPages);
  const canGoBack = page > 1 && Boolean(onPageChange);
  const canGoForward = page < totalPages && Boolean(onPageChange);

  return (
    <footer className="table-footer">
      <div className="page-size">
        <span>Showing</span>
        <button type="button" disabled aria-label={`${limit} mục mỗi trang`}>{limit} <ChevronDown size={16} /></button>
        <span>of {total}</span>
      </div>

      <nav className="pagination" aria-label="Phân trang">
        <button type="button" aria-label="Trang trước" disabled={!canGoBack} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16} /></button>
        {pageNumbers.map((pageNumber) => (
          <button
            className={pageNumber === page ? 'active' : ''}
            type="button"
            disabled={!onPageChange || pageNumber === page}
            onClick={() => onPageChange(pageNumber)}
            key={pageNumber}
          >
            {pageNumber}
          </button>
        ))}
        <button type="button" aria-label="Trang sau" disabled={!canGoForward} onClick={() => onPageChange(page + 1)}><ChevronRight size={16} /></button>
      </nav>
    </footer>
  );
}
