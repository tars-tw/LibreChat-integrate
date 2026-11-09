import { useLocalize } from '~/hooks';
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  Button,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
  Checkbox,
} from '@librechat/client';
import type { TTarsTokenUserQuota, TTarsTokenPrepareData } from 'librechat-data-provider';
import type { TokenResetType } from './helpers';
import {
  BADGE_ON,
  RESET_TYPES,
  BADGE_NEUTRAL,
  RESET_LABEL_KEYS,
  capOf,
  formatLimit,
  usesResetDay,
  formatThreshold,
  isActiveQuota,
  quotaUsageShare,
  providerBadgeClass,
} from './helpers';
import {
  useTarsTokenQuotasQuery,
  useDeleteTarsTokenQuotaMutation,
  useTarsTokenReportMembersQuery,
  useBatchDeleteTarsTokenQuotasMutation,
} from '~/data-provider';
import { formatTokens, recentReportRange } from './Report/helpers';
import TokenQuotaInfo from './TokenQuotaInfo';
import QuotaModal from './QuotaModal';
import Toolbar from './Toolbar';
import Pagination from './Pagination';

export default function Quotas({
  options,
}: {
  options: TTarsTokenPrepareData | undefined;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const [editing, setEditing] = useState<TTarsTokenUserQuota | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TTarsTokenUserQuota | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

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
   * the trailing 30 days, which is not the same number as `used_amount`.
   */
  const recentRange = useMemo(recentReportRange, []);
  const allGroupIds = useMemo(
    () => (options?.groups ?? []).map((group) => group.id),
    [options],
  );

  const membersQuery = useTarsTokenReportMembersQuery(
    allGroupIds.length === 0
      ? null
      : { ...recentRange, user_group_ids: allGroupIds },
  );

  const recentUsage = useMemo(() => {
    const usage = new Map<string, number>();

    for (const member of membersQuery.data ?? []) {
      usage.set(String(member.user_id ?? ''), member.total_tokens);
    }

    return usage;
  }, [membersQuery.data]);

  /** Group dropdown options */
  const groupOptions = useMemo(
    () =>
      (options?.groups ?? []).map((group) => ({
        value: group.id,
        label: group.name,
      })),
    [options?.groups],
  );

  /** Filter users and groups locally. */
  const filteredQuotas = useMemo(() => {
    const normalizedUser = userSearch.trim().toLowerCase();

    return quotas.filter((quota) => {
      const matchesUser =
        normalizedUser === '' ||
        [quota.display_name, quota.username, quota.email].some((value) =>
          String(value ?? '').toLowerCase().includes(normalizedUser),
        );

      const matchesGroup =
        groupFilter === '' ||
        (quota.user_group_id ?? '')
          .split(',')
          .map((id) => id.trim())
          .includes(groupFilter);

      return matchesUser && matchesGroup;
    });
  }, [quotas, userSearch, groupFilter]);

  /** Pagination */
  const totalPages = Math.max(1, Math.ceil(filteredQuotas.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);

  const paginatedQuotas = useMemo(() => {
    const start = currentPage * pageSize;
    return filteredQuotas.slice(start, start + pageSize);
  }, [filteredQuotas, currentPage, pageSize]);

  /** A new search or filter starts a new selection, so nothing out of sight is deleted. */
  useEffect(() => {
    setSelected(new Set());
  }, [userSearch, groupFilter, provider, status]);

  /** Only rows that match the current filters count, whatever the set holds. */
  const selectedRows = useMemo(
    () => filteredQuotas.filter((quota) => selected.has(quota.id)),
    [filteredQuotas, selected],
  );
  const pageSelectedCount = paginatedQuotas.filter((quota) => selected.has(quota.id)).length;
  const pageAllSelected = paginatedQuotas.length > 0 && pageSelectedCount === paginatedQuotas.length;
  const pageSomeSelected = pageSelectedCount > 0 && !pageAllSelected;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const quota of paginatedQuotas) {
        if (pageAllSelected) {
          next.delete(quota.id);
        } else {
          next.add(quota.id);
        }
      }
      return next;
    });

  const deleteMutation = useDeleteTarsTokenQuotaMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_tars_quota_deleted'),
        status: 'success',
      });
      setDeleting(null);
    },
    onError: () =>
      showToast({
        message: localize('com_ui_tars_admin_error'),
        status: 'error',
      }),
  });

  const batchDeleteMutation = useBatchDeleteTarsTokenQuotasMutation({
    onSuccess: (result) => {
      showToast({
        message: localize('com_ui_tars_quota_batch_deleted', { 0: String(result.deleted) }),
        status: 'success',
      });
      setBatchDeleting(false);
      setSelected(new Set());
    },
    onError: () =>
      showToast({
        message: localize('com_ui_tars_admin_error'),
        status: 'error',
      }),
  });

  return (
    <div className="space-y-4">
      <Toolbar
        userSearch={userSearch}
        groupFilter={groupFilter}
        groupOptions={groupOptions}
        provider={provider}
        status={status}
        onUserSearchChange={(value) => {
          setUserSearch(value);
          setPage(0);
        }}
        onGroupFilterChange={(value) => {
          setGroupFilter(value);
          setPage(0);
        }}
        onProviderChange={(value) => {
          setProvider(value);
          setPage(0);
        }}
        onStatusChange={(value) => {
          setStatus(value);
          setPage(0);
        }}
        onShowInfo={() => setShowInfo(true)}
        onAdd={() => setCreating(true)}
        extraActions={
          <>
            <Button
              variant="destructive"
              disabled={selectedRows.length === 0}
              onClick={() => setBatchDeleting(true)}
            >
              <Trash2 className="mr-2 size-4" aria-hidden />
              {localize('com_ui_tars_quota_batch_delete')}
              {selectedRows.length > 0 && ` (${selectedRows.length})`}
            </Button>
            <Button
              variant="outline"
              disabled={selectedRows.length === 0}
              onClick={() => setSelected(new Set())}
            >
              {localize('com_ui_tars_quota_clear_selection')}
            </Button>
          </>
        }
      />

      {showInfo && (
        <TokenQuotaInfo open={showInfo} onOpenChange={setShowInfo} />
      )}

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!isLoading && filteredQuotas.length === 0 && (
        <p className="text-text-secondary py-12 text-center text-sm">
          {quotas.length === 0
            ? localize('com_ui_tars_quota_empty')
            : '找不到符合條件的資料'}
        </p>
      )}

      {!isLoading && filteredQuotas.length > 0 && (
        <>
          <div className="border-border-light overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[68rem] table-fixed text-sm">
              <thead className="bg-surface-secondary text-text-secondary text-left">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <Checkbox
                      aria-label={localize('com_ui_tars_quota_select_page')}
                      checked={pageSomeSelected ? 'indeterminate' : pageAllSelected}
                      onCheckedChange={togglePage}
                    />
                  </th>
                  <th className="w-[15%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_quota_col_user')}
                  </th>
                  <th className="w-[18%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_quota_col_group')}
                  </th>
                  <th className="w-[8%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_quota_col_provider')}
                  </th>
                  <th className="w-[10%] px-3 py-2 text-right font-medium">
                    {localize('com_ui_tars_quota_custom_limit')}
                  </th>
                  <th className="w-[10%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_quota_used')}
                  </th>
                  <th className="w-[8%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_quota_col_reset')}
                  </th>
                  <th className="w-[8%] px-3 py-2 text-right font-medium">
                    {localize('com_ui_tars_quota_warning_threshold')}
                  </th>
                  <th className="w-[10%] px-3 py-2 text-right font-medium">
                    {localize('com_ui_tars_quota_recent_col')}
                  </th>
                  <th className="w-[6%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_quota_col_status')}
                  </th>
                  <th className="w-[6%] px-3 py-2 text-right font-medium">
                    {localize('com_ui_actions')}
                  </th>
                </tr>
              </thead>

              <tbody>
                {paginatedQuotas.map((quota) => (
                  <tr
                    key={quota.id}
                    className={`border-border-light hover:bg-surface-hover border-t ${
                      selected.has(quota.id) ? 'bg-surface-active-alt' : ''
                    }`}
                  >
                    <td className="px-3 py-2">
                      <Checkbox
                        aria-label={quota.display_name ?? quota.username ?? quota.id}
                        checked={selected.has(quota.id)}
                        onCheckedChange={() => toggleOne(quota.id)}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <span className="text-text-primary block truncate">
                        {quota.display_name ?? quota.username ?? '—'}
                      </span>
                      <span className="text-text-secondary block truncate text-xs">
                        {quota.email ?? quota.username ?? '—'}
                      </span>
                    </td>

                    <td className="text-text-secondary max-w-[9rem] whitespace-normal break-words px-3 py-2">
                      {quota.group_name ?? '—'}
                    </td>

                    <td className="px-3 py-2">
                      <span className={providerBadgeClass(quota.provider)}>
                        {quota.provider ?? 'system'}
                      </span>
                    </td>

                    <td className="text-text-secondary px-3 py-2 text-right tabular-nums">
                      {capOf(quota.custom_limit) == null ? (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs whitespace-nowrap text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                          {localize('com_ui_tars_quota_unlimited')}
                        </span>
                      ) : (
                        formatLimit(
                          quota.custom_limit,
                          localize('com_ui_tars_quota_unlimited'),
                        )
                      )}
                    </td>

                    <td className="px-3 py-2">
                      <div className="text-text-secondary flex items-center justify-between gap-2 text-xs tabular-nums">
                        <span>
                          {(quota.used_amount ?? 0).toLocaleString()}
                        </span>
                        {capOf(quota.custom_limit) != null && (
                          <span>{quotaUsageShare(quota)}%</span>
                        )}
                      </div>

                      <div className="bg-surface-tertiary mt-1 h-1.5 overflow-hidden rounded-full">
                        {capOf(quota.custom_limit) == null ? (
                          <div
                            className="h-full w-full rounded-full"
                            style={{
                              background:
                                'linear-gradient(90deg, #FDE293 0%, #F4B4A6 35%, #AECBFA 65%, #A8DAB5 100%)',
                            }}
                          />
                        ) : (
                          <div
                            className="bg-brand-primary h-full rounded-full"
                            style={{ width: `${quotaUsageShare(quota)}%` }}
                          />
                        )}
                      </div>
                    </td>

                    <td className="text-text-secondary px-3 py-2">
                      {RESET_TYPES.includes(
                        quota.reset_type as TokenResetType,
                      )
                        ? localize(
                            RESET_LABEL_KEYS[
                              quota.reset_type as TokenResetType
                            ],
                          )
                        : (quota.reset_type ?? '—')}
                      {usesResetDay(quota.reset_type) &&
                        ` (${localize('com_ui_tars_quota_day', {
                          0: String(quota.reset_day ?? 1),
                        })})`}
                    </td>

                    <td className="text-text-secondary px-3 py-2 text-right tabular-nums">
                      {formatThreshold(quota.warning_threshold)}
                    </td>

                    <td className="text-text-secondary px-3 py-2 text-right tabular-nums">
                      {recentUsage.has(String(quota.user_id ?? ''))
                        ? formatTokens(
                            recentUsage.get(String(quota.user_id ?? '')),
                          )
                        : '—'}
                    </td>

                    <td className="px-3 py-2">
                      <span
                        className={
                          isActiveQuota(quota) ? BADGE_ON : BADGE_NEUTRAL
                        }
                      >
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
                          className="text-text-secondary hover:bg-surface-tertiary hover:text-text-primary rounded p-1.5"
                        >
                          <Pencil className="icon-sm" />
                        </button>

                        <button
                          type="button"
                          aria-label={localize('com_ui_delete')}
                          title={localize('com_ui_delete')}
                          onClick={() => setDeleting(quota)}
                          className="text-text-secondary hover:bg-surface-tertiary rounded p-1.5 hover:text-red-500"
                        >
                          <Trash2 className="icon-sm text-pwc-danger" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={currentPage}
            pageSize={pageSize}
            totalItems={filteredQuotas.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
          />
        </>
      )}

      {(creating || editing != null) && (
        <QuotaModal
          key={editing?.id ?? 'new'}
          quota={editing}
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
        <OGDialog
          open={true}
          onOpenChange={(open) => !open && setDeleting(null)}
        >
          <OGDialogTemplate
            title={localize('com_ui_tars_quota_user_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <p className="text-text-secondary text-sm">
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
                {deleteMutation.isLoading ? (
                  <Spinner />
                ) : (
                  localize('com_ui_delete')
                )}
              </Button>
            }
          />
        </OGDialog>
      )}

      {batchDeleting && (
        <OGDialog
          open={true}
          onOpenChange={(open) => !open && setBatchDeleting(false)}
        >
          <OGDialogTemplate
            title={localize('com_ui_tars_quota_batch_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <p className="text-text-secondary text-sm">
                {localize('com_ui_tars_quota_batch_delete_confirm', {
                  0: String(selectedRows.length),
                })}
              </p>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() =>
                  batchDeleteMutation.mutate({ ids: selectedRows.map((quota) => quota.id) })
                }
                disabled={batchDeleteMutation.isLoading || selectedRows.length === 0}
              >
                {batchDeleteMutation.isLoading ? (
                  <Spinner />
                ) : (
                  localize('com_ui_delete')
                )}
              </Button>
            }
          />
        </OGDialog>
      )}
    </div>
  );
}
