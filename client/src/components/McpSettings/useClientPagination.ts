import { useMemo, useState } from 'react';

export const MCP_PAGE_SIZES = [10, 25, 50, 100];

/** Client-side pagination shared by every MCP settings tab's list/table. */
export function useClientPagination<T>(items: T[], initialPageSize: number = MCP_PAGE_SIZES[0]) {
  const [rawPage, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(rawPage, pageCount - 1);
  const pageItems = useMemo(
    () => items.slice(page * pageSize, page * pageSize + pageSize),
    [items, page, pageSize],
  );

  const setPageSize = (size: number) => {
    setPageSizeState(size);
    setPage(0);
  };

  return { page, setPage, pageSize, setPageSize, pageCount, pageItems };
}
