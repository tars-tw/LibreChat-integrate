import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Button, Spinner, disabledFillClasses } from '@librechat/client';
import type { TTarsTokenUserQuota, TTarsTokenUserUsage } from 'librechat-data-provider';
import { capOf, effectiveLimitOf, isActiveQuota, personIdentity } from '../helpers';
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
  const limit = capOf(effectiveLimitOf(quota));
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
        {quota.effective_source === 'default' &&
          ` · ${localize('com_ui_tars_report_ceiling_system_default')}`}
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

/** A provider without a personal quota: show usage against the system default. */
function DefaultLine({
  provider,
  limit,
  used,
}: {
  provider: string;
  limit: number | null;
  used: number;
}) {
  const localize = useLocalize();
  const pct = limit == null || limit <= 0 ? null : Math.min(Math.round((used / limit) * 100), 100);

  const exceeded = pct != null && pct >= 100;
  const warning = pct != null && pct >= 80;

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
        {' · '}
        {localize('com_ui_tars_report_ceiling_system_default')}
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
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const ranked = useMemo(() => {
    return [...members]
      .filter((member) => {
        const userId = String(member.user_id ?? '');
        const { primary, secondary } = personIdentity(member, userId);
        const keyword = search.trim().toLowerCase();

        return (
          primary.toLowerCase().includes(keyword) ||
          (secondary ?? '').toLowerCase().includes(keyword) ||
          (member.email ?? '').toLowerCase().includes(keyword) ||
          userId.toLowerCase().includes(keyword)
        );
      })
      .sort((a, b) => b.total_tokens - a.total_tokens);
  }, [members, search]);

  const totalPages = Math.max(1, Math.ceil(ranked.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = ranked.slice((safePage - 1) * pageSize, safePage * pageSize);
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
        <div className="flex shrink-0 items-center gap-2">
          <div className="border-border-medium bg-surface-primary flex h-8 w-56 items-center gap-2 rounded-md border px-2">
            <Search className="text-text-secondary size-4 shrink-0" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={localize('com_ui_tars_report_member_search_placeholder')}
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

          <Button variant="outline" size="sm" onClick={onClear}>
            {localize('com_ui_tars_report_clear_drilldown')}
          </Button>
        </div>
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
                    {search
                      ? localize('com_ui_tars_report_member_search_empty')
                      : localize('com_ui_tars_audit_no_data')}
                  </td>
                </tr>
              )}
              {paginatedRows.map((member) => {
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
                      {member.email ? (
                        <span className="text-text-secondary block truncate text-xs">
                          {member.email}
                        </span>
                      ) : (
                        secondary != null && (
                          <span className="text-text-secondary block truncate text-xs">
                            {secondary}
                          </span>
                        )
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
                              used={member.usage_by_provider?.[provider] ?? 0}
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
          {totalPages > 1 && (
            <div className="border-border-light flex items-center justify-between border-t px-4 py-3">
              <span className="text-text-secondary text-xs">
                {(currentPage - 1) * pageSize + 1} -{' '}
                {Math.min(currentPage * pageSize, ranked.length)} / {ranked.length}
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
                  {safePage} / {totalPages}
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
        </div>
      )}
    </section>
  );
}
