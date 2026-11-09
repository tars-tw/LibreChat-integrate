import { useId } from 'react';
import { Button, Dropdown } from '@librechat/client';
import { useLocalize } from '~/hooks';

export const PAGE_SIZES = [10, 25, 50, 100];

interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const localize = useLocalize();
  const labelId = useId();

  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));

  return (
    <div className="text-text-secondary flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span id={labelId}>{localize('com_ui_tars_users_rows_per_page')}</span>
        <Dropdown
          value={String(pageSize)}
          onChange={(value) => onPageSizeChange(Number(value))}
          options={PAGE_SIZES.map(String)}
          aria-labelledby={labelId}
          sizeClasses="min-w-[5rem]"
        />
      </div>

      <div className="flex items-center gap-2">
        <span>
          {localize('com_ui_tars_users_page_of', {
            current: page + 1,
            total: pageCount,
          })}
        </span>

        <Button variant="outline" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          {localize('com_ui_tars_users_prev_page')}
        </Button>

        <Button
          variant="outline"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
        >
          {localize('com_ui_tars_users_next_page')}
        </Button>
      </div>
    </div>
  );
}
