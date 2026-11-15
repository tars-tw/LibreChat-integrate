import { useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { Spinner } from '@librechat/client';
import type { AuditColumn, AuditRow, CellFormat } from './helpers';
import type { ResponsePair } from './ResponseDialog';
import { downloadBlob, formatDateTime, toCsvBlob } from '../Users/helpers';
import { agentLabel, cellText, PAGE_SIZES } from './helpers';
import { useLocalize } from '~/hooks';
import Toolbar from './Toolbar';
import AuditCell from './Cell';
import Pager from './Pager';

/** A flat, one-row-per-message audit table: toolbar, rows, pager. */
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
  const [shownRows, setShownRows] = useState(rows);

  /** A new result set invalidates the current page number, before it paints. */
  if (shownRows !== rows) {
    setShownRows(rows);
    setPage(1);
  }

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

  const format: CellFormat = {
    date: (value) => formatDateTime(value, locale),
    agent: (row) => agentLabel(row, localize),
    deletedUser: localize('com_ui_tars_audit_trace_user_deleted'),
  };

  /** Exports every row and every column, not just what is on screen. */
  const exportCsv = () => {
    const headers = columns.map((column) => localize(column.labelKey));
    const body = rows.map((row) => columns.map((column) => cellText(row, column, format)));
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadBlob(toCsvBlob(headers, body), `${exportName}_${stamp}.csv`);
  };

  return (
    <div className="space-y-2">
      <Toolbar
        columns={columns}
        visible={visible}
        onVisibleChange={onVisibleChange}
        onExport={exportCsv}
        canExport={rows.length > 0}
      />

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
                      <AuditCell
                        row={row}
                        column={column}
                        format={format}
                        onViewResponse={onViewResponse}
                        onViewTrace={onViewTrace}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rows.length > 0 && (
        <Pager
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          indicator={localize('com_ui_tars_audit_page_indicator', {
            0: String(currentPage),
            1: String(totalPages),
            2: String(rows.length),
          })}
        />
      )}
    </div>
  );
}
