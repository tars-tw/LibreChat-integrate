import { useMemo, useState } from 'react';
import { disabledFillClasses } from '@librechat/client';
import { ChevronRight, ChevronLeft, Search, X } from 'lucide-react';
import type { TTarsTokenGroupUsage } from 'librechat-data-provider';
import { formatTokens } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * Group usage for the period. Groups are a way to read spending (which team uses
 * the most), not something quotas are set on — quotas belong to people — so this
 * table shows consumption only and drills into a group's members.
 */
export default function Groups({
  rows,
  selectedId,
  onSelect,
}: {
  rows: TTarsTokenGroupUsage[];
  selectedId: string | null;
  onSelect: (groupId: string, groupName: string) => void;
}) {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const ranked = useMemo(() => {
    return [...rows]
      .filter((group) =>
        (group.user_group_name ?? group.user_group_id ?? '')
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      )
      .sort((a, b) => b.total_tokens - a.total_tokens);
  }, [rows, search]);

  const totalPages = Math.ceil(ranked.length / pageSize);

  const paginatedRows = ranked.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <section className="border-border-light rounded-xl border">
      <header className="border-border-light flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <h2 className="text-text-primary text-sm font-medium">
          {localize('com_ui_tars_report_group_usage')}
        </h2>

        <div className="border-border-medium bg-surface-primary flex h-8 w-full max-w-56 items-center gap-2 rounded-md border px-2">
          <Search className="text-text-secondary size-4 shrink-0" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            placeholder={localize('com_ui_tars_report_group_search_placeholder')}
            className="text-text-primary placeholder:text-text-secondary min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCurrentPage(1);
              }}
              className="text-text-secondary hover:text-text-primary"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-surface-secondary text-text-secondary text-left">
            <tr>
              <th className="w-[40%] px-3 py-2 font-medium">
                {localize('com_ui_tars_quota_col_group')}
              </th>
              <th className="w-[15%] px-3 py-2 text-right font-medium">
                {localize('com_ui_tars_report_col_users')}
              </th>
              <th className="w-[20%] px-3 py-2 text-right font-medium">
                {localize('com_ui_tars_report_col_logs')}
              </th>
              <th className="w-[25%] px-3 py-2 text-right font-medium">
                {localize('com_ui_tars_report_col_tokens')}
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.length === 0 && (
              <tr>
                <td colSpan={4} className="text-text-secondary px-3 py-6 text-center">
                  {search
                    ? localize('com_ui_tars_report_group_search_empty')
                    : localize('com_ui_tars_audit_no_data')}
                </td>
              </tr>
            )}
            {paginatedRows.map((group) => {
              const groupId = String(group.user_group_id ?? '');
              const groupName = group.user_group_name ?? groupId;
              return (
                <tr
                  key={groupId}
                  onClick={() => onSelect(groupId, groupName)}
                  className={`border-border-light hover:bg-surface-hover cursor-pointer border-t ${
                    selectedId === groupId ? 'bg-surface-tertiary' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <span className="text-text-primary flex items-center gap-1.5">
                      <ChevronRight className="text-text-secondary size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 truncate" title={groupName}>
                        {groupName}
                      </span>
                    </span>
                  </td>
                  <td className="text-text-secondary px-3 py-2 text-right tabular-nums">
                    {formatTokens(group.user_count)}
                  </td>
                  <td className="text-text-secondary px-3 py-2 text-right tabular-nums">
                    {formatTokens(group.log_count)}
                  </td>
                  <td className="text-text-primary px-3 py-2 text-right tabular-nums">
                    {formatTokens(group.total_tokens)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="border-border-light flex items-center justify-between border-t px-4 py-3">
          <span className="text-text-secondary text-xs">
            {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, ranked.length)} /{' '}
            {ranked.length}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className={`text-text-secondary hover:bg-surface-hover rounded-md p-1.5 disabled:cursor-not-allowed ${disabledFillClasses}`}
            >
              <ChevronLeft className="size-4" />
            </button>

            <span className="text-text-primary text-xs tabular-nums">
              {currentPage} / {totalPages}
            </span>

            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className={`text-text-secondary hover:bg-surface-hover rounded-md p-1.5 disabled:cursor-not-allowed ${disabledFillClasses}`}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
