import { AlertTriangle } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import type { TTarsTokenUserUsage } from 'librechat-data-provider';
import type { QuotaCeiling } from './helpers';
import { ceilingShare, formatTokens, isOverWarning } from './helpers';
import { personIdentity } from '../helpers';
import { useLocalize } from '~/hooks';

/**
 * The members of the drilled-into group, against their personal ceilings. A
 * person with no override shows the group rule's ceiling as "inherited", which
 * is what pwc_tars falls back to when it meters their request.
 */
export default function Members({
  groupName,
  members,
  ceilings,
  inherited,
  isLoading,
  onSelect,
  onClear,
}: {
  groupName: string;
  members: TTarsTokenUserUsage[];
  ceilings: Map<string, QuotaCeiling>;
  inherited: QuotaCeiling | undefined;
  isLoading: boolean;
  onSelect: (user: TTarsTokenUserUsage) => void;
  onClear: () => void;
}) {
  const localize = useLocalize();
  const ranked = [...members].sort((a, b) => b.total_tokens - a.total_tokens);

  return (
    <section className="rounded-xl border border-border-light">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light px-4 py-2">
        <h2 className="text-sm font-medium text-text-primary">
          {localize('com_ui_tars_report_members_of', { 0: groupName })}
        </h2>
        <Button variant="outline" size="sm" onClick={onClear}>
          {localize('com_ui_tars_report_clear_drilldown')}
        </Button>
      </header>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-surface-secondary text-left text-text-secondary">
              <tr>
                <th className="w-[28%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_quota_col_user')}
                </th>
                <th className="w-[12%] px-3 py-2 text-right font-medium">
                  {localize('com_ui_tars_report_col_logs')}
                </th>
                <th className="w-[15%] px-3 py-2 text-right font-medium">
                  {localize('com_ui_tars_report_col_tokens')}
                </th>
                <th className="w-[20%] px-3 py-2 text-right font-medium">
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
                  <td colSpan={5} className="px-3 py-6 text-center text-text-secondary">
                    {localize('com_ui_tars_audit_no_data')}
                  </td>
                </tr>
              )}
              {ranked.map((member) => {
                const userId = String(member.user_id ?? '');
                const own = ceilings.get(userId);
                const ceiling = own ?? inherited;
                const share = ceilingShare(member.total_tokens, ceiling);
                const warning = isOverWarning(share, ceiling);
                const { primary, secondary } = personIdentity(member, userId);
                return (
                  <tr
                    key={userId}
                    onClick={() => onSelect(member)}
                    className="cursor-pointer border-t border-border-light hover:bg-surface-hover"
                  >
                    <td className="px-3 py-2">
                      <span className="block truncate font-medium text-text-primary">
                        {primary}
                      </span>
                      {secondary != null && (
                        <span className="block truncate text-xs text-text-secondary">
                          {secondary}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                      {formatTokens(member.log_count)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary">
                      {formatTokens(member.total_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="block tabular-nums text-text-secondary">
                        {ceiling?.limit == null
                          ? localize('com_ui_tars_quota_unlimited')
                          : formatTokens(ceiling.limit)}
                      </span>
                      <span className="block text-xs text-text-secondary">
                        {localize(
                          own == null
                            ? 'com_ui_tars_report_ceiling_inherited'
                            : 'com_ui_tars_report_ceiling_personal',
                        )}
                      </span>
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
      )}
    </section>
  );
}
