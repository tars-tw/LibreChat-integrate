import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { TTarsTokenGroupUsage } from 'librechat-data-provider';
import type { QuotaCeiling } from './helpers';
import { ceilingShare, formatTokens, isOverWarning } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * Group usage for the period against the ceiling its quota rules set. The share
 * is the period's usage over that ceiling — pwc_tars keeps its own reset-cycle
 * counter on the quota tab, which counts from the last reset rather than from
 * the queried range.
 */
export default function Groups({
  rows,
  ceilings,
  selectedId,
  onSelect,
}: {
  rows: TTarsTokenGroupUsage[];
  ceilings: Map<string, QuotaCeiling>;
  selectedId: string | null;
  onSelect: (groupId: string, groupName: string) => void;
}) {
  const localize = useLocalize();
  const ranked = [...rows].sort((a, b) => b.total_tokens - a.total_tokens);

  return (
    <section className="rounded-xl border border-border-light">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-light px-4 py-2">
        <h2 className="text-sm font-medium text-text-primary">
          {localize('com_ui_tars_report_group_usage')}
        </h2>
        <p className="text-xs text-text-secondary">{localize('com_ui_tars_report_ceiling_hint')}</p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-surface-secondary text-left text-text-secondary">
            <tr>
              <th className="w-[22%] px-3 py-2 font-medium">
                {localize('com_ui_tars_quota_col_group')}
              </th>
              <th className="w-[10%] px-3 py-2 text-right font-medium">
                {localize('com_ui_tars_report_col_users')}
              </th>
              <th className="w-[12%] px-3 py-2 text-right font-medium">
                {localize('com_ui_tars_report_col_logs')}
              </th>
              <th className="w-[15%] px-3 py-2 text-right font-medium">
                {localize('com_ui_tars_report_col_tokens')}
              </th>
              <th className="w-[15%] px-3 py-2 text-right font-medium">
                {localize('com_ui_tars_report_col_ceiling')}
              </th>
              <th className="px-3 py-2 font-medium">
                {localize('com_ui_tars_report_col_utilization')}
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-secondary">
                  {localize('com_ui_tars_audit_no_data')}
                </td>
              </tr>
            )}
            {ranked.map((group) => {
              const groupId = String(group.user_group_id ?? '');
              const groupName = group.user_group_name ?? groupId;
              const ceiling = ceilings.get(groupId);
              const share = ceilingShare(group.total_tokens, ceiling);
              const warning = isOverWarning(share, ceiling);
              return (
                <tr
                  key={groupId}
                  onClick={() => onSelect(groupId, groupName)}
                  className={`cursor-pointer border-t border-border-light hover:bg-surface-hover ${
                    selectedId === groupId ? 'bg-surface-tertiary' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5 text-text-primary">
                      <ChevronRight className="size-4 shrink-0 text-text-secondary" aria-hidden />
                      <span className="min-w-0 truncate" title={groupName}>
                        {groupName}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {formatTokens(group.user_count)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {formatTokens(group.log_count)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-primary">
                    {formatTokens(group.total_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {ceiling?.limit == null
                      ? localize('com_ui_tars_quota_unlimited')
                      : formatTokens(ceiling.limit)}
                  </td>
                  <td className="px-3 py-2">
                    {share == null ? (
                      <span className="text-xs text-text-secondary">
                        {localize('com_ui_tars_report_no_ceiling')}
                      </span>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                          <span className={warning ? 'text-red-500' : 'text-text-secondary'}>
                            {`${share}%`}
                          </span>
                          {warning && (
                            <AlertTriangle
                              className="size-3.5 text-red-500"
                              aria-label={localize('com_ui_tars_report_over_warning')}
                            />
                          )}
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                          <div
                            className={`h-full rounded-full ${
                              warning ? 'bg-red-500' : 'bg-brand-primary'
                            }`}
                            style={{ width: `${Math.min(share, 100)}%` }}
                          />
                        </div>
                      </>
                    )}
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
