import { useId } from 'react';
import { Button, Dropdown } from '@librechat/client';
import { PAGE_SIZE_OPTIONS } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * Previous / next with a page indicator. The page-size picker shows only when
 * `onPageSizeChange` is given, so an expanded conversation's fixed ten-a-page
 * pager reuses it without the dropdown.
 */
export default function Pager({
  page,
  totalPages,
  indicator,
  onPageChange,
  pageSize,
  onPageSizeChange,
  size = 'default',
}: {
  page: number;
  totalPages: number;
  indicator: string;
  onPageChange: (page: number) => void;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  size?: 'default' | 'sm';
}) {
  const localize = useLocalize();
  /** Several pagers render at once, so the size label needs an id unique to this one. */
  const pageSizeLabelId = useId();

  return (
    <footer className="text-text-secondary flex flex-wrap items-center justify-between gap-3 text-sm">
      {onPageSizeChange != null && pageSize != null ? (
        <div className="flex items-center gap-2">
          <span id={pageSizeLabelId}>{localize('com_ui_tars_audit_rows_per_page')}</span>
          <Dropdown
            value={String(pageSize)}
            onChange={(value) => onPageSizeChange(Number(value))}
            options={PAGE_SIZE_OPTIONS}
            aria-labelledby={pageSizeLabelId}
            sizeClasses="min-w-[5rem]"
          />
        </div>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        <span>{indicator}</span>
        <Button
          variant="outline"
          size={size}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          {localize('com_ui_tars_users_prev_page')}
        </Button>
        <Button
          variant="outline"
          size={size}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          {localize('com_ui_tars_users_next_page')}
        </Button>
      </div>
    </footer>
  );
}
