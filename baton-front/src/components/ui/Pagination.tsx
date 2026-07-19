import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;

interface UsePaginationOptions {
  storageKey: string;
  pageSizes?: readonly number[];
  defaultPageSize?: number;
  // When this value changes (===), page resets to 1. Caller passes a hash of
  // active filters so the list jumps back to the top after a filter toggle.
  resetKey?: unknown;
}

export function usePagination<T>(items: T[], options: UsePaginationOptions) {
  const {
    storageKey,
    pageSizes = DEFAULT_PAGE_SIZES,
    defaultPageSize = 25,
    resetKey,
  } = options;

  const [pageSize, setPageSizeState] = useState<number>(() => {
    const raw = parseInt(localStorage.getItem(storageKey) || String(defaultPageSize), 10);
    return (pageSizes as readonly number[]).includes(raw) ? raw : defaultPageSize;
  });
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => { setPage(1); }, [resetKey, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const pageStart = (page - 1) * pageSize;
  const pageItems = items.slice(pageStart, pageStart + pageSize);

  function changePageSize(n: number) {
    setPageSizeState(n);
    try { localStorage.setItem(storageKey, String(n)); } catch {}
  }

  function getPageNumbers(): (number | 'ellipsis')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | 'ellipsis')[] = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    if (start > 2) pages.push('ellipsis');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  }

  return {
    pageItems,
    page,
    setPage,
    pageSize,
    changePageSize,
    totalPages,
    getPageNumbers,
    pageSizes,
  };
}

interface PaginationFooterProps {
  page: number;
  setPage: (n: number | ((p: number) => number)) => void;
  pageSize: number;
  changePageSize: (n: number) => void;
  totalPages: number;
  getPageNumbers: () => (number | 'ellipsis')[];
  pageSizes: readonly number[];
}

export function PaginationFooter({
  page,
  setPage,
  pageSize,
  changePageSize,
  totalPages,
  getPageNumbers,
  pageSizes,
}: PaginationFooterProps) {
  return (
    <div className="bg-white border-t border-gray-200/80 px-4 py-2.5 flex items-center justify-between gap-2 shrink-0">
      <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span>Show</span>
        <select
          value={pageSize}
          onChange={(e) => changePageSize(parseInt(e.target.value, 10))}
          className="rounded border border-gray-200 bg-white text-[11px] font-medium text-gray-700 px-1.5 py-[3px] focus:outline-none focus:ring-1 focus:ring-violet-400 cursor-pointer"
        >
          {pageSizes.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span>per page</span>
      </label>

      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="p-1 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        {getPageNumbers().map((p, idx) =>
          p === 'ellipsis' ? (
            <span key={`e${idx}`} className="px-1 text-[11px] text-gray-300 select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={clsx(
                'min-w-[22px] h-[22px] px-1.5 rounded text-[11px] font-medium tabular-nums transition-colors',
                p === page
                  ? 'bg-violet-100 text-violet-700'
                  : 'text-gray-500 hover:bg-gray-100',
              )}
            >
              {p}
            </button>
          ),
        )}
        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          className="p-1 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          aria-label="Next page"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
