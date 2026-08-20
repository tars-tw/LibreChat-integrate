import { useId } from 'react';
import { Download, Inbox, Info } from 'lucide-react';
import { Button, Dropdown, Spinner } from '@librechat/client';
import type { TTarsActionLog, TTarsActionLogModule } from 'librechat-data-provider';
import type { TimelineTarget } from './TimelineDialog';
import { moduleLabel, statusTone, PAGE_SIZE_OPTIONS } from './helpers';
import { formatDateTime } from '../Users/helpers';
import ActionBadge from './ActionBadge';
import { useLocalize } from '~/hooks';

/**
 * The operation trail. Paging is pwc_tars-side, so the pager reports the server's
 * total and turning a page issues a new request rather than slicing an array.
 */
export default function OperationsTable({
  logs,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  isLoading,
  isExporting,
  modules,
  locale,
  onSelectLog,
  onSelectUser,
  onExport,
}: {
  logs: TTarsActionLog[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  isLoading: boolean;
  isExporting: boolean;
  modules: TTarsActionLogModule[];
  locale: string;
  onSelectLog: (log: TTarsActionLog) => void;
  onSelectUser: (target: TimelineTarget) => void;
  onExport: () => void;
}) {
  const localize = useLocalize();
  const pageSizeLabelId = useId();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onExport}
          disabled={total === 0 || isExporting}
          aria-label={localize('com_ui_tars_audit_export')}
          title={localize('com_ui_tars_audit_export')}
        >
          {isExporting ? (
            <Spinner className="size-4" />
          ) : (
            <Download className="size-4" aria-hidden />
          )}
        </Button>
      </div>

      <div className="data-table-scroll max-h-[70vh] overflow-auto rounded-lg border border-border-light">
        {isLoading && logs.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary">
            <Spinner className="size-4" />
            {localize('com_ui_loading')}
          </div>
        )}

        {!isLoading && logs.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-text-secondary">
            <Inbox className="size-6" aria-hidden />
            {localize('com_ui_tars_audit_no_data')}
          </div>
        )}

        {logs.length > 0 && (
          <table className="w-max min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface-secondary">
              <tr>
                {[
                  'com_ui_tars_ops_col_time',
                  'com_ui_tars_audit_col_user',
                  'com_ui_tars_ops_col_action',
                  'com_ui_tars_ops_col_module',
                  'com_ui_tars_ops_col_description',
                  'com_ui_tars_ops_col_status',
                ].map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 text-left font-medium text-text-secondary"
                  >
                    {localize(key as 'com_ui_tars_ops_col_time')}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 text-left font-medium text-text-secondary">
                  {localize('com_ui_tars_ops_col_detail')}
                </th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-t border-border-light align-top hover:bg-surface-tertiary"
                >
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-primary">
                    {formatDateTime(log.created_at, locale)}
                  </td>
                  <td className="px-3 py-1.5">
                    {/* The name opens that operator's whole timeline — the usual next question. */}
                    <button
                      type="button"
                      disabled={log.user_id == null || log.user_id === ''}
                      onClick={() =>
                        onSelectUser({
                          userId: log.user_id as string,
                          username: log.username,
                          email: log.user_email,
                        })
                      }
                      title={localize('com_ui_tars_ops_view_timeline')}
                      className="block max-w-[14rem] text-left disabled:cursor-default"
                    >
                      <span className="block truncate text-text-primary underline-offset-2 hover:underline">
                        {log.username ?? '—'}
                      </span>
                      <span className="block truncate text-xs text-text-secondary">
                        {log.user_email ?? log.user_id ?? ''}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-1.5">
                    <ActionBadge action={log.action_type} />
                  </td>
                  <td className="px-3 py-1.5 text-text-primary">
                    <span className="block max-w-[14rem] truncate">
                      {moduleLabel(log.module, modules)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-text-primary">
                    <span
                      className="block max-w-[26rem] truncate"
                      title={log.description ?? undefined}
                    >
                      {log.description ?? '—'}
                    </span>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-1.5 ${statusTone(log.status)}`}>
                    {log.status ?? '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onSelectLog(log)}
                      aria-label={localize('com_ui_tars_ops_view_detail')}
                      title={localize('com_ui_tars_ops_view_detail')}
                    >
                      <Info className="size-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > 0 && (
        <footer className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
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
          <div className="flex items-center gap-2">
            <span>
              {localize('com_ui_tars_audit_page_indicator', {
                0: String(page),
                1: String(totalPages),
                2: String(total),
              })}
            </span>
            <Button variant="outline" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
              {localize('com_ui_tars_users_prev_page')}
            </Button>
            <Button
              variant="outline"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
            >
              {localize('com_ui_tars_users_next_page')}
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
