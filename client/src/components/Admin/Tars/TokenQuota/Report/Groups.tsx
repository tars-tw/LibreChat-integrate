import { ChevronRight } from 'lucide-react';
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
  const ranked = [...rows].sort((a, b) => b.total_tokens - a.total_tokens);

  return (
    <section className="border-border-light rounded-xl border">
      <header className="border-border-light flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2">
        <h2 className="text-text-primary text-sm font-medium">
          {localize('com_ui_tars_report_group_usage')}
        </h2>
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
                  {localize('com_ui_tars_audit_no_data')}
                </td>
              </tr>
            )}
            {ranked.map((group) => {
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
    </section>
  );
}
