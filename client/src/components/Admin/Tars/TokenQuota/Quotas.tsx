import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { TTarsTokenUserQuota, TTarsTokenPrepareData } from 'librechat-data-provider';
import type { TokenResetType } from './helpers';
import {
  BADGE_ON,
  RESET_TYPES,
  BADGE_NEUTRAL,
  TOKEN_PROVIDERS,
  RESET_LABEL_KEYS,
  capOf,
  QUOTA_STATUS_ON,
  QUOTA_STATUS_OFF,
  formatLimit,
  usesResetDay,
  formatThreshold,
  isActiveQuota,
  quotaUsageShare,
} from './helpers';
import {
  useTarsTokenQuotasQuery,
  useDeleteTarsTokenQuotaMutation,
  useTarsTokenReportMembersQuery,
} from '~/data-provider';
import { formatTokens, recentReportRange } from './Report/helpers';
import QuotaModal from './QuotaModal';
import { useLocalize } from '~/hooks';

const SELECT_CLASS =
  'h-10 rounded-md border border-border-light bg-surface-primary px-3 text-sm text-text-primary';

/**
 * Per-person overrides, with the consumption pwc_tars counts against each one.
 * The used bar is the point of the table: a quota only matters relative to what
 * the person has already spent.
 */
export default function Quotas({ options }: { options: TTarsTokenPrepareData | undefined }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<TTarsTokenUserQuota | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TTarsTokenUserQuota | null>(null);

  const filters = useMemo(
    () => ({
      provider: provider === '' ? undefined : provider,
      status: status === '' ? undefined : status,
    }),
    [provider, status],
  );

  const { data: quotas = [], isLoading } = useTarsTokenQuotasQuery(filters);

  /**
   * Recent consumption beside each ceiling. This is the report's own count over
   * the trailing 30 days, which is not the same number as `used_amount` — that
   * one counts from pwc_tars' last quota reset.
   */
  const recentRange = useMemo(recentReportRange, []);
  const allGroupIds = useMemo(() => (options?.groups ?? []).map((group) => group.id), [options]);
  const membersQuery = useTarsTokenReportMembersQuery(
    allGroupIds.length === 0 ? null : { ...recentRange, user_group_ids: allGroupIds },
  );
  const recentUsage = useMemo(() => {
    const usage = new Map<string, number>();
    for (const member of membersQuery.data ?? []) {
      usage.set(String(member.user_id ?? ''), member.total_tokens);
    }
    return usage;
  }, [membersQuery.data]);

  const deleteMutation = useDeleteTarsTokenQuotaMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_quota_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label={localize('com_ui_tars_quota_col_provider')}
          className={SELECT_CLASS}
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        >
          <option value="">{localize('com_ui_tars_quota_all_providers')}</option>
          {TOKEN_PROVIDERS.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>

        <select
          aria-label={localize('com_ui_tars_quota_col_status')}
          className={SELECT_CLASS}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">{localize('com_ui_tars_quota_all_statuses')}</option>
          <option value={QUOTA_STATUS_ON}>{localize('com_ui_tars_quota_active')}</option>
          <option value={QUOTA_STATUS_OFF}>{localize('com_ui_tars_quota_suspended')}</option>
        </select>

        <Button variant="submit" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus className="mr-2 size-4" aria-hidden />
          {localize('com_ui_tars_quota_user_add')}
        </Button>
      </div>

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!isLoading && quotas.length === 0 && (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_quota_empty')}
        </p>
      )}

      {!isLoading && quotas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border-light">
          <table className="w-full min-w-[68rem] text-sm">
            <thead className="bg-surface-secondary text-left text-text-secondary">
              <tr>
                <th className="w-[18%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_quota_col_user')}
                </th>
                <th className="w-[12%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_quota_col_domain')}
                </th>
                <th className="w-[8%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_quota_col_provider')}
                </th>
                <th className="w-[10%] px-3 py-2 text-right font-medium">
                  {localize('com_ui_tars_quota_custom_limit')}
                </th>
                <th className="w-[13%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_quota_used')}
                </th>
                <th className="w-[11%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_quota_col_reset')}
                </th>
                <th className="w-[7%] px-3 py-2 text-right font-medium">
                  {localize('com_ui_tars_quota_warning_threshold')}
                </th>
                <th className="w-[10%] px-3 py-2 text-right font-medium">
                  {localize('com_ui_tars_quota_recent_col')}
                </th>
                <th className="w-[7%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_quota_col_status')}
                </th>
                <th className="w-[4%] px-3 py-2 text-right font-medium">
                  {localize('com_ui_actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {quotas.map((quota) => (
                <tr key={quota.id} className="border-t border-border-light hover:bg-surface-hover">
                  <td className="px-3 py-2">
                    <span className="block truncate text-text-primary">
                      {quota.display_name ?? quota.username ?? '—'}
                    </span>
                    <span className="block truncate text-xs text-text-secondary">
                      {quota.email ?? quota.username ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    <span className="block truncate">{quota.domain_name ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={BADGE_NEUTRAL}>{quota.provider ?? 'system'}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {formatLimit(quota.custom_limit, localize('com_ui_tars_quota_unlimited'))}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-text-secondary">
                      <span>{(quota.used_amount ?? 0).toLocaleString()}</span>
                      {capOf(quota.custom_limit) != null && <span>{quotaUsageShare(quota)}%</span>}
                    </div>
                    {capOf(quota.custom_limit) != null && (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                        <div
                          className="h-full rounded-full bg-brand-primary"
                          style={{ width: `${quotaUsageShare(quota)}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">
                    {RESET_TYPES.includes(quota.reset_type as TokenResetType)
                      ? localize(RESET_LABEL_KEYS[quota.reset_type as TokenResetType])
                      : (quota.reset_type ?? '—')}
                    {usesResetDay(quota.reset_type) &&
                      ` (${localize('com_ui_tars_quota_day', { 0: String(quota.reset_day ?? 1) })})`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {formatThreshold(quota.warning_threshold)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {recentUsage.has(String(quota.user_id ?? ''))
                      ? formatTokens(recentUsage.get(String(quota.user_id ?? '')))
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={isActiveQuota(quota) ? BADGE_ON : BADGE_NEUTRAL}>
                      {localize(
                        isActiveQuota(quota)
                          ? 'com_ui_tars_quota_active'
                          : 'com_ui_tars_quota_suspended',
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        aria-label={localize('com_ui_edit')}
                        title={localize('com_ui_edit')}
                        onClick={() => setEditing(quota)}
                        className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                      >
                        <Pencil className="icon-sm" />
                      </button>
                      <button
                        type="button"
                        aria-label={localize('com_ui_delete')}
                        title={localize('com_ui_delete')}
                        onClick={() => setDeleting(quota)}
                        className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-red-500"
                      >
                        <Trash2 className="icon-sm" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing != null) && (
        <QuotaModal
          key={editing?.id ?? 'new'}
          quota={editing}
          options={options}
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      )}

      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_quota_user_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <p className="text-sm text-text-secondary">
                {localize('com_ui_tars_quota_delete_confirm', {
                  0: `${deleting.display_name ?? deleting.username ?? '—'} · ${deleting.provider ?? 'system'}`,
                })}
              </p>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(deleting.id)}
                disabled={deleteMutation.isLoading}
              >
                {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      )}
    </div>
  );
}
