import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { TTarsTokenConfig, TTarsTokenPrepareData } from 'librechat-data-provider';
import type { TokenResetType } from './helpers';
import {
  BADGE_ON,
  RESET_TYPES,
  BADGE_NEUTRAL,
  TOKEN_PROVIDERS,
  RESET_LABEL_KEYS,
  formatLimit,
  usesResetDay,
  formatThreshold,
  groupConfigsByGroup,
} from './helpers';
import {
  useTarsTokenConfigsQuery,
  useDeleteTarsTokenConfigMutation,
  useTarsTokenReportOverviewQuery,
} from '~/data-provider';
import { formatTokens, recentReportRange } from './Report/helpers';
import ConfigModal from './ConfigModal';
import { useLocalize } from '~/hooks';

const SELECT_CLASS =
  'h-10 rounded-md border border-border-light bg-surface-primary px-3 text-sm text-text-primary';

/**
 * Group-level quota rules, grouped the way they are read: one user group's
 * brains together. pwc_tars resolves a chat request against the most specific
 * rule, so the precedence note stays visible above the table.
 */
export default function Configs({ options }: { options: TTarsTokenPrepareData | undefined }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [groupId, setGroupId] = useState('');
  const [provider, setProvider] = useState('');
  const [editing, setEditing] = useState<TTarsTokenConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TTarsTokenConfig | null>(null);

  const filters = useMemo(
    () => ({
      user_group_id: groupId === '' ? undefined : groupId,
      provider: provider === '' ? undefined : provider,
    }),
    [groupId, provider],
  );

  const { data: configs = [], isLoading } = useTarsTokenConfigsQuery(filters);
  const grouped = useMemo(() => groupConfigsByGroup(configs), [configs]);

  /** Recent consumption next to the ceilings, so a rule can be judged in place. */
  const recentRange = useMemo(recentReportRange, []);
  const overviewQuery = useTarsTokenReportOverviewQuery(recentRange);
  const recentUsage = useMemo(() => {
    const usage = new Map<string, number>();
    for (const group of overviewQuery.data?.group_overview ?? []) {
      usage.set(String(group.user_group_id ?? ''), group.total_tokens);
    }
    return usage;
  }, [overviewQuery.data]);

  const deleteMutation = useDeleteTarsTokenConfigMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_quota_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-border-light bg-surface-secondary px-4 py-3 text-sm text-text-secondary">
        {localize('com_ui_tars_quota_precedence')}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label={localize('com_ui_tars_quota_col_group')}
          className={SELECT_CLASS}
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
        >
          <option value="">{localize('com_ui_tars_quota_all_groups')}</option>
          {(options?.groups ?? []).map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>

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

        <Button variant="submit" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus className="mr-2 size-4" aria-hidden />
          {localize('com_ui_tars_quota_config_add')}
        </Button>
      </div>

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!isLoading && configs.length === 0 && (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_quota_empty')}
        </p>
      )}

      {!isLoading &&
        grouped.map((group) => (
          <section key={group.groupName} className="rounded-xl border border-border-light">
            <header className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-2">
              <h3 className="text-sm font-medium text-text-primary">{group.groupName}</h3>
              <div className="flex items-center gap-2">
                {recentUsage.has(group.groupId) && (
                  <span className={BADGE_NEUTRAL}>
                    {localize('com_ui_tars_quota_recent_usage', {
                      0: formatTokens(recentUsage.get(group.groupId)),
                    })}
                  </span>
                )}
                <span className={BADGE_NEUTRAL}>
                  {localize('com_ui_tars_quota_rule_count', { 0: String(group.rows.length) })}
                </span>
              </div>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="bg-surface-secondary text-left text-text-secondary">
                  <tr>
                    <th className="w-[20%] px-3 py-2 font-medium">
                      {localize('com_ui_tars_quota_col_domain')}
                    </th>
                    <th className="w-[10%] px-3 py-2 font-medium">
                      {localize('com_ui_tars_quota_col_provider')}
                    </th>
                    <th className="w-[15%] px-3 py-2 text-right font-medium">
                      {localize('com_ui_tars_quota_default_user_limit')}
                    </th>
                    <th className="w-[15%] px-3 py-2 text-right font-medium">
                      {localize('com_ui_tars_quota_system_total_limit')}
                    </th>
                    <th className="w-[15%] px-3 py-2 font-medium">
                      {localize('com_ui_tars_quota_col_reset')}
                    </th>
                    <th className="w-[10%] px-3 py-2 text-right font-medium">
                      {localize('com_ui_tars_quota_warning_threshold')}
                    </th>
                    <th className="w-[8%] px-3 py-2 font-medium">
                      {localize('com_ui_tars_quota_col_status')}
                    </th>
                    <th className="w-[7%] px-3 py-2 text-right font-medium">
                      {localize('com_ui_actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((config) => (
                    <tr
                      key={config.id}
                      className="border-t border-border-light hover:bg-surface-hover"
                    >
                      <td className="px-3 py-2">
                        <span className="block truncate text-text-primary">
                          {config.domain_name ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={BADGE_NEUTRAL}>{config.provider ?? 'system'}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                        {formatLimit(
                          config.default_user_limit,
                          localize('com_ui_tars_quota_unlimited'),
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                        {formatLimit(
                          config.system_total_limit,
                          localize('com_ui_tars_quota_unlimited'),
                        )}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        {RESET_TYPES.includes(config.reset_type as TokenResetType)
                          ? localize(RESET_LABEL_KEYS[config.reset_type as TokenResetType])
                          : (config.reset_type ?? '—')}
                        {usesResetDay(config.reset_type) &&
                          ` (${localize('com_ui_tars_quota_day', { 0: String(config.reset_day ?? 1) })})`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                        {formatThreshold(config.warning_threshold)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={config.is_active ? BADGE_ON : BADGE_NEUTRAL}>
                          {localize(
                            config.is_active
                              ? 'com_ui_tars_quota_active'
                              : 'com_ui_tars_quota_inactive',
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            aria-label={localize('com_ui_edit')}
                            title={localize('com_ui_edit')}
                            onClick={() => setEditing(config)}
                            className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                          >
                            <Pencil className="icon-sm" />
                          </button>
                          <button
                            type="button"
                            aria-label={localize('com_ui_delete')}
                            title={localize('com_ui_delete')}
                            onClick={() => setDeleting(config)}
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
          </section>
        ))}

      {(creating || editing != null) && (
        <ConfigModal
          key={editing?.id ?? 'new'}
          config={editing}
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
            title={localize('com_ui_tars_quota_config_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <p className="text-sm text-text-secondary">
                {localize('com_ui_tars_quota_delete_confirm', {
                  0: `${deleting.group_name ?? '—'} · ${deleting.domain_name ?? '—'} · ${deleting.provider ?? 'system'}`,
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
