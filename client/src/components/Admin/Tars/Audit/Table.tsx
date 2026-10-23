import { useEffect, useId, useMemo, useState } from 'react';
import { Button, Dropdown, Spinner } from '@librechat/client';
import {
  Eye,
  Check,
  Globe,
  Inbox,
  Database,
  Download,
  ChartGantt,
  SlidersHorizontal,
} from 'lucide-react';
import type { AuditColumn, AuditRow } from './helpers';
import type { ResponsePair } from './ResponseDialog';
import { cellText, commentLines, PAGE_SIZE_OPTIONS, PAGE_SIZES } from './helpers';
import { downloadBlob, formatDateTime, toCsvBlob } from '../Users/helpers';
import ColumnPicker from './ColumnPicker';
import { useLocalize } from '~/hooks';

/**
 * One audit table: toolbar, rows, pager.
 *
 * Both tabs share it because they differ only in which columns they declare —
 * the cell rendering, the column picker, the CSV export and the paging are
 * identical, and duplicating them would let the two drift apart.
 */
export default function AuditTable({
  rows,
  columns,
  visible,
  onVisibleChange,
  isLoading,
  locale,
  onViewResponse,
  onViewTrace,
  exportName,
  emptyHint,
}: {
  rows: AuditRow[];
  columns: AuditColumn[];
  visible: string[];
  onVisibleChange: (fields: string[]) => void;
  isLoading: boolean;
  locale: string;
  onViewResponse: (pair: ResponsePair) => void;
  onViewTrace?: (messageId: string) => void;
  exportName: string;
  emptyHint: string;
}) {
  const localize = useLocalize();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[1]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Both tabs render a table, so the size label needs an id unique to this one. */
  const pageSizeLabelId = useId();

  /** A new result set invalidates the current page number. */
  useEffect(() => {
    setPage(1);
  }, [rows]);

  const shown = useMemo(
    () => columns.filter((column) => column.locked === true || visible.includes(column.field)),
    [columns, visible],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize],
  );

  const formatDate = (value: string | null | undefined) => formatDateTime(value, locale);

  /** Exports every row and every column, not just what is on screen. */
  const exportCsv = () => {
    const headers = columns.map((column) => localize(column.labelKey));
    const body = rows.map((row) => columns.map((column) => cellText(row, column, formatDate)));
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadBlob(toCsvBlob(headers, body), `${exportName}_${stamp}.csv`);
  };

  const renderCell = (row: AuditRow, column: AuditColumn) => {
    if (column.kind === 'response') {
      const viewResponse = (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onViewResponse({ query: row.user_query, response: row.model_response })}
          aria-label={localize('com_ui_tars_audit_view_response')}
          title={localize('com_ui_tars_audit_view_response')}
        >
          <Eye className="size-4 text-[rgb(var(--pwc-info))]" aria-hidden />
        </Button>
      );
      if (!onViewTrace) {
        return viewResponse;
      }
      return (
        <div className="flex gap-1">
          {viewResponse}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onViewTrace(row.message_id)}
            aria-label={localize('com_ui_tars_audit_trace_view_button')}
            title={localize('com_ui_tars_audit_trace_view_button')}
          >
            <ChartGantt className="text-text-secondary size-4" aria-hidden />
          </Button>
        </div>
      );
    }

    if (column.kind === 'boolean') {
      const on = row[column.field as 'is_web_search' | 'is_sql_agent'] === true;
      if (!on) {
        return <span className="text-text-secondary">—</span>;
      }
      const Icon = column.field === 'is_web_search' ? Globe : Database;
      return <Icon className="text-brand-primary size-4" aria-label={localize(column.labelKey)} />;
    }

    if (column.kind === 'deleted') {
      return row.is_deleted ? (
        <Check
          className="text-pwc-danger mt-1.5 size-4"
          aria-label={localize('com_ui_tars_audit_col_deleted')}
        />
      ) : null;
    }

    if (column.kind === 'comments') {
      const lines = commentLines(row.comments);
      if (lines.length === 0) {
        return null;
      }
      return (
        <ul className="w-[18rem] list-disc space-y-0.5 pl-4">
          {lines.map((line, index) => (
            <li key={index} className="break-words whitespace-normal">
              {line}
            </li>
          ))}
        </ul>
      );
    }

    const text = cellText(row, column, formatDate);
    if (column.kind === 'number') {
      return <span className="tabular-nums">{text}</span>;
    }
    return (
      <span className="block max-w-[22rem] truncate" title={text === '' ? undefined : text}>
        {text}
      </span>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPickerOpen(true)}
          aria-label={localize('com_ui_tars_audit_columns')}
          title={localize('com_ui_tars_audit_columns')}
        >
          <SlidersHorizontal className="text-text-primary size-4 dark:text-white" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={exportCsv}
          disabled={rows.length === 0}
          aria-label={localize('com_ui_tars_audit_export')}
          title={localize('com_ui_tars_audit_export')}
        >
          <Download className="text-text-primary size-4 dark:text-white" aria-hidden />
        </Button>
      </div>

      {/* Bounded so the horizontal scrollbar rides at the bottom of a box that is
          always on screen. Left to grow with the page, it sits below a full page of
          rows and can only be reached by scrolling past every one of them. */}
      <div className="data-table-scroll border-border-light max-h-[70vh] overflow-auto rounded-lg border">
        {isLoading && (
          <div className="text-text-secondary flex items-center justify-center gap-2 py-10 text-sm">
            <Spinner className="size-4" />
            {localize('com_ui_loading')}
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div className="text-text-secondary flex flex-col items-center gap-2 py-10 text-sm">
            <Inbox className="size-6" aria-hidden />
            {emptyHint}
          </div>
        )}

        {/* `w-max` lets the table outgrow the card and scroll once enough columns are
            shown; `min-w-full` keeps a narrow selection filling the card instead. */}
        {!isLoading && rows.length > 0 && (
          <table className="w-max min-w-full border-collapse text-sm">
            <thead className="bg-surface-secondary sticky top-0 z-10">
              <tr>
                {shown.map((column) => (
                  <th
                    key={column.field}
                    scope="col"
                    className="text-text-secondary px-3 py-2 text-left font-medium whitespace-nowrap"
                  >
                    {localize(column.labelKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((row) => (
                <tr
                  key={row.message_id}
                  className="border-border-light hover:bg-surface-tertiary border-t align-top"
                >
                  {shown.map((column) => (
                    <td key={column.field} className="text-text-primary px-3 py-1.5">
                      {renderCell(row, column)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rows.length > 0 && (
        <footer className="text-text-secondary flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span id={pageSizeLabelId}>{localize('com_ui_tars_audit_rows_per_page')}</span>
            <Dropdown
              value={String(pageSize)}
              onChange={(value) => {
                setPageSize(Number(value));
                setPage(1);
              }}
              options={PAGE_SIZE_OPTIONS}
              aria-labelledby={pageSizeLabelId}
              sizeClasses="min-w-[5rem]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span>
              {localize('com_ui_tars_audit_page_indicator', {
                0: String(currentPage),
                1: String(totalPages),
                2: String(rows.length),
              })}
            </span>
            <Button
              variant="outline"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              {localize('com_ui_tars_users_prev_page')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              {localize('com_ui_tars_users_next_page')}
            </Button>
          </div>
        </footer>
      )}

      <ColumnPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        columns={columns}
        visible={visible}
        onChange={onVisibleChange}
      />
    </div>
  );
}
