import { useMemo } from 'react';
import { Button, Spinner } from '@librechat/client';
import type { TTarsTokenUserQuota, TTarsTokenUserUsage } from 'librechat-data-provider';
import { capOf, isActiveQuota, personIdentity } from '../helpers';
import { useTarsTokenDefaultsQuery } from '~/data-provider';
import { formatTokens } from './helpers';
import { useLocalize } from '~/hooks';

const PROVIDER_ORDER = ['openai', 'gemini', 'anthropic'];

const PROVIDER_STYLE: Record<string, { label: string; swatch: string }> = {
  openai: { label: 'OpenAI', swatch: 'bg-series-2' },
  gemini: { label: 'Gemini', swatch: 'bg-series-4' },
  anthropic: { label: 'Anthropic', swatch: 'bg-series-1' },
};

const FALLBACK_STYLE = { label: '—', swatch: 'bg-text-tertiary' };

const EXCEEDED_BAR = 'bg-status-error';
const WARNING_BAR = 'bg-status-warning';
const EXCEEDED_TEXT = 'text-status-error';
const WARNING_TEXT = 'text-status-warning';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

const styleOf = (provider: string) =>
  PROVIDER_STYLE[provider] ?? { ...FALLBACK_STYLE, label: provider };

function ProviderName({ provider }: { provider: string }) {
  const { label, swatch } = styleOf(provider);
  return (
    <>
      <span className={`size-1.5 shrink-0 rounded-full ${swatch}`} aria-hidden="true" />
      <span className="text-text-primary font-medium">{label}</span>
    </>
  );
}

/**
 * One provider's personal quota: what the current cycle has spent against its own
 * ceiling. This is the figure pwc_tars enforces, so it is read straight off the quota
 * rather than derived from the report's period totals.
 */
function QuotaLine({ quota, provider }: { quota: TTarsTokenUserQuota; provider: string }) {
  const localize = useLocalize();
  const limit = capOf(quota.custom_limit);
  const used = quota.used_amount ?? 0;
  const pct = limit == null ? null : Math.min(Math.round((used / limit) * 100), 100);
  const threshold = Math.round((quota.warning_threshold ?? 0.8) * 100);
  const exceeded = pct != null && pct >= 100;
  const warning = pct != null && pct >= threshold;
  let statusText = 'text-text-secondary';
  let statusBar = styleOf(provider).swatch;

  if (exceeded) {
    statusText = EXCEEDED_TEXT;
    statusBar = EXCEEDED_BAR;
  } else if (warning) {
    statusText = WARNING_TEXT;
    statusBar = WARNING_BAR;
  }

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-1.5 text-xs">
        <ProviderName provider={provider} />
        {pct != null && <span className={`tabular-nums ${statusText}`}>· {pct}%</span>}
      </div>
      <div className="text-text-secondary text-xs tabular-nums">
        {limit == null
          ? `${compact.format(used)} · ${localize('com_ui_tars_quota_unlimited')}`
          : `${compact.format(used)} / ${compact.format(limit)}`}
      </div>
      <div className="bg-surface-tertiary h-1.5 w-30 overflow-hidden rounded-full">
        {pct == null ? (
          <div className="tars-usage-gradient h-full w-full rounded-full" />
        ) : (
          <div className={`h-full rounded-full ${statusBar}`} style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}

/** A provider the person holds no personal quota for: the provider's system default applies. */
function DefaultLine({ provider, limit }: { provider: string; limit: number | null }) {
  const localize = useLocalize();

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-1.5 text-xs">
        <ProviderName provider={provider} />
      </div>

      <div className="text-text-secondary text-xs tabular-nums">
        {limit == null ? localize('com_ui_tars_quota_unlimited') : compact.format(limit)}
        {' · '}
        {localize('com_ui_tars_report_ceiling_system_default')}
      </div>

      <div className="bg-surface-tertiary h-1.5 w-30 overflow-hidden rounded-full">
        <div className="tars-usage-gradient h-full w-full rounded-full" />
      </div>
    </div>
  );
}

/**
 * The members of the drilled-into group. The quota column lays the three providers out
 * side by side: a provider with a personal quota shows its bar, any other shows the
 * provider's name with a note that the system default applies.
 */
export default function Members({
  groupName,
  members,
  quotas = [],
  isLoading,
  onSelect,
  onClear,
}: {
  groupName: string;
  members: TTarsTokenUserUsage[];
  quotas: TTarsTokenUserQuota[];
  isLoading: boolean;
  onSelect: (user: TTarsTokenUserUsage) => void;
  onClear: () => void;
}) {
  const localize = useLocalize();
  const ranked = [...members].sort((a, b) => b.total_tokens - a.total_tokens);
  const { data: defaults = [] } = useTarsTokenDefaultsQuery();

  /** Each provider's system default ceiling; null means none (unset, inactive or -1). */
  const defaultLimits = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const config of defaults) {
      if (config.provider == null) {
        continue;
      }
      map.set(config.provider, config.is_active ? capOf(config.default_user_limit) : null);
    }
    return map;
  }, [defaults]);

  /** Active personal quotas per person, then per provider. Suspended ones are not enforced. */
  const quotasByUser = useMemo(() => {
    const map = new Map<string, Map<string, TTarsTokenUserQuota>>();
    for (const quota of quotas) {
      if (quota.user_id == null || quota.provider == null || !isActiveQuota(quota)) {
        continue;
      }
      const key = String(quota.user_id);
      const byProvider = map.get(key) ?? new Map<string, TTarsTokenUserQuota>();
      byProvider.set(quota.provider, quota);
      map.set(key, byProvider);
    }
    return map;
  }, [quotas]);

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
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-surface-secondary text-text-secondary text-left">
              <tr>
                <th className="w-[20%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_quota_col_user')}
                </th>
                <th className="w-[15%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_report_col_logs')}
                </th>
                <th className="w-[15%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_report_col_tokens')}
                </th>
                <th className="px-3 py-2 font-medium">
                  {`${localize('com_ui_tars_report_col_ceiling')} / ${localize('com_ui_tars_report_col_utilization')}`}
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
              {ranked.map((member) => {
                const userId = String(member.user_id ?? '');
                const own = quotasByUser.get(userId);
                const { primary, secondary } = personIdentity(member, userId);
                return (
                  <tr
                    key={userId}
                    onClick={() => onSelect(member)}
                    className="border-border-light hover:bg-surface-hover cursor-pointer border-t align-top"
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
                    <td className="text-text-secondary px-3 py-2 tabular-nums">
                      {formatTokens(member.log_count)}
                    </td>
                    <td className="text-text-primary px-3 py-2 tabular-nums">
                      {formatTokens(member.total_tokens)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="grid grid-cols-3 gap-4">
                        {PROVIDER_ORDER.map((provider) => {
                          const quota = own?.get(provider);
                          return quota ? (
                            <QuotaLine key={provider} quota={quota} provider={provider} />
                          ) : (
                            <DefaultLine
                              key={provider}
                              provider={provider}
                              limit={defaultLimits.get(provider) ?? null}
                            />
                          );
                        })}
                      </div>
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
