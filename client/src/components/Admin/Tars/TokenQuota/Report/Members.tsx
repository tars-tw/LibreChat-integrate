import { AlertTriangle } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import type { TTarsTokenUserUsage } from 'librechat-data-provider';
import type { QuotaCeiling } from './helpers';
import { ceilingShare, formatTokens, isOverWarning } from './helpers';
import { personIdentity } from '../helpers';
import { useLocalize } from '~/hooks';

/**
 * The members of the drilled-into group, against their personal ceilings. Someone
 * with no personal quota is held to the provider's system default, which is a
 * per-provider rule rather than one number, so no ceiling or utilization is drawn
 * for them — only a note that the default applies.
 */
export default function Members({
  groupName,
  members,
  ceilings,
  isLoading,
  onSelect,
  onClear,
}: {
  groupName: string;
  members: TTarsTokenUserUsage[];
  ceilings: Map<string, QuotaCeiling>;
  isLoading: boolean;
  onSelect: (user: TTarsTokenUserUsage) => void;
  onClear: () => void;
}) {
  const localize = useLocalize();
  const ranked = [...members].sort((a, b) => b.total_tokens - a.total_tokens);

  return (
    <section className="border-border-light rounded-xl border">
      <header className="border-border-light flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <h2 className="text-text-primary text-sm font-medium">
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
            <thead className="bg-surface-secondary text-text-secondary text-left">
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
                  <td colSpan={5} className="text-text-secondary px-3 py-6 text-center">
                    {localize('com_ui_tars_audit_no_data')}
                  </td>
                </tr>
              )}
              {ranked.map((member) => {
                const userId = String(member.user_id ?? '');
                const own = ceilings.get(userId);
                const share = ceilingShare(member.total_tokens, own);
                const warning = isOverWarning(share, own);
                const { primary, secondary } = personIdentity(member, userId);
                return (
                  <tr
                    key={userId}
                    onClick={() => onSelect(member)}
                    className="border-border-light hover:bg-surface-hover cursor-pointer border-t"
                  >
                    <td className="px-3 py-2">
                      <span className="text-text-primary block truncate font-medium">
                        {primary}
                      </span>
                      {secondary != null && (
                        <span className="text-text-secondary block truncate text-xs">
                          {secondary}
                        </span>
                      )}
                    </td>
                    <td className="text-text-secondary px-3 py-2 text-right tabular-nums">
                      {formatTokens(member.log_count)}
                    </td>
                    <td className="text-text-primary px-3 py-2 text-right tabular-nums">
                      {formatTokens(member.total_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {own == null ? (
                        <span className="text-text-secondary block text-xs">
                          {localize('com_ui_tars_report_ceiling_system_default')}
                        </span>
                      ) : (
                        <>
                          <span className="text-text-secondary block tabular-nums">
                            {own.limit == null
                              ? localize('com_ui_tars_quota_unlimited')
                              : formatTokens(own.limit)}
                          </span>
                          <span className="text-text-secondary block text-xs">
                            {localize('com_ui_tars_report_ceiling_personal')}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {share == null ? (
                        <span className="text-text-secondary text-xs">
                          {own == null ? '—' : localize('com_ui_tars_report_no_ceiling')}
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
                          <div className="bg-surface-tertiary mt-1 h-1.5 overflow-hidden rounded-full">
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
