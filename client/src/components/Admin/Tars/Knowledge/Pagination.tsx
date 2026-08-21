import { useId, useMemo, useState } from 'react';
import { Button, Dropdown } from '@librechat/client';
import { useLocalize } from '~/hooks';

/** Same ladder the people-administration table offers. */
export const PAGE_SIZES = [10, 25, 50, 100];
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String);

export interface PageState<T> {
  /** The rows to render for the current page. */
  rows: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

/**
 * Slices a list into pages.
 *
 * The page index is clamped rather than reset, so deleting the last row of the
 * final page lands on the new final page instead of an empty one — and a
 * changed filter cannot strand the view past the end of its own results.
 */
export function usePagination<T>(items: T[]): PageState<T> {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = useMemo(
    () => items.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [items, currentPage, pageSize],
  );

  return {
    rows,
    page: currentPage,
    pageSize,
    pageCount,
    setPage,
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(0);
    },
  };
}

/** The footer that drives `usePagination`, matching the other admin tables. */
export default function Pagination<T>({ state }: { state: PageState<T> }) {
  const localize = useLocalize();
  const labelId = useId();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
      <div className="flex items-center gap-2">
        <span id={labelId}>{localize('com_ui_tars_users_rows_per_page')}</span>
        <Dropdown
          value={String(state.pageSize)}
          onChange={(value) => state.setPageSize(Number(value))}
          options={PAGE_SIZE_OPTIONS}
          aria-labelledby={labelId}
          sizeClasses="min-w-[5rem]"
        />
      </div>
      <div className="flex items-center gap-2">
        <span>
          {localize('com_ui_tars_users_page_of', {
            current: state.page + 1,
            total: state.pageCount,
          })}
        </span>
        <Button
          variant="outline"
          disabled={state.page === 0}
          onClick={() => state.setPage(state.page - 1)}
        >
          {localize('com_ui_tars_users_prev_page')}
        </Button>
        <Button
          variant="outline"
          disabled={state.page >= state.pageCount - 1}
          onClick={() => state.setPage(state.page + 1)}
        >
          {localize('com_ui_tars_users_next_page')}
        </Button>
      </div>
    </div>
  );
}
