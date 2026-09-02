import { Button, Dropdown } from '@librechat/client';
import { MCP_PAGE_SIZES } from './useClientPagination';
import { useLocalize } from '~/hooks';

const PAGE_SIZE_OPTIONS = MCP_PAGE_SIZES.map(String);

/** Rows-per-page + prev/next controls shared by every MCP settings tab. */
export default function McpPaginationControls({
  labelId,
  page,
  pageCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  labelId: string;
  page: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const localize = useLocalize();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
      <div className="flex items-center gap-2">
        <span id={labelId}>{localize('com_ui_tars_mcp_rows_per_page')}</span>
        <Dropdown
          value={String(pageSize)}
          onChange={(value) => onPageSizeChange(Number(value))}
          options={PAGE_SIZE_OPTIONS}
          aria-labelledby={labelId}
          sizeClasses="min-w-[5rem]"
        />
      </div>
      <div className="flex items-center gap-2">
        <span>{localize('com_ui_tars_mcp_page_of', { current: page + 1, total: pageCount })}</span>
        <Button variant="outline" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          {localize('com_ui_tars_mcp_prev_page')}
        </Button>
        <Button
          variant="outline"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
        >
          {localize('com_ui_tars_mcp_next_page')}
        </Button>
      </div>
    </div>
  );
}
