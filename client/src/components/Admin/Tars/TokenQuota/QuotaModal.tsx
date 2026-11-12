import { useMemo, useState } from 'react';
import { User, Users } from 'lucide-react';
import { PrincipalType } from 'librechat-data-provider';
import {
  Chip,
  Label,
  Input,
  Button,
  Switch,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type {
  TPrincipal,
  TTarsTokenUserQuota,
  TTarsTokenQuotaBatchInput,
  TTarsTokenQuotaBatchResult,
} from 'librechat-data-provider';
import {
  RESET_TYPES,
  QUOTA_STATUS_ON,
  QUOTA_STATUS_OFF,
  TOKEN_PROVIDERS,
  RESET_LABEL_KEYS,
  usesResetDay,
  isActiveQuota,
  personName,
  providerBadgeClass,
} from './helpers';
import DirectoryPeoplePicker from '~/components/Sharing/PeoplePicker/DirectoryPeoplePicker';
import LimitInput, { toLimitField, fromLimitField, isValidLimitField } from './LimitInput';
import { useBatchSetTarsTokenQuotasMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-border-light bg-surface-primary px-3 text-sm text-text-primary disabled:opacity-50';

const keyOf = (principal: TPrincipal) =>
  `${principal.type}:${principal.idOnTheSource ?? principal.name}`;

const mergeUnique = (...lists: TPrincipal[][]): TPrincipal[] => {
  const byKey = new Map<string, TPrincipal>();
  for (const list of lists) {
    for (const principal of list) {
      byKey.set(keyOf(principal), principal);
    }
  }
  return [...byKey.values()];
};

/**
 * The personal-quota editor. Quotas are per person: when creating, users and groups are
 * picked from the directory and groups are only a shortcut — the backend expands them to
 * their current members and writes one quota per person × provider, so a group is a
 * snapshot, not a rule. Editing an existing row goes through the same endpoint with the
 * one user it belongs to.
 */
export default function QuotaModal({
  quota,
  open,
  onOpenChange,
}: {
  quota: TTarsTokenUserQuota | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [assignees, setAssignees] = useState<TPrincipal[]>([]);
  /** Checked in the picker but not yet added with its Add button — still saved. */
  const [pending, setPending] = useState<TPrincipal[]>([]);
  const [providers, setProviders] = useState<string[]>(() => [
    quota?.provider ?? TOKEN_PROVIDERS[0],
  ]);
  const [customLimit, setCustomLimit] = useState(() => toLimitField(quota?.custom_limit));
  const [active, setActive] = useState(quota == null ? true : isActiveQuota(quota));
  const [resetType, setResetType] = useState(quota?.reset_type ?? 'monthly');
  const [resetDay, setResetDay] = useState(String(quota?.reset_day ?? 1));
  const [warningPercent, setWarningPercent] = useState(
    String(Math.round((quota?.warning_threshold ?? 0.8) * 100)),
  );

  const targets = assignees;
  const excludeIds = useMemo(
    () => assignees.map((principal) => principal.idOnTheSource),
    [assignees],
  );
  const hasGroup = targets.some((principal) => principal.type === PrincipalType.GROUP);

  const onError = (error: unknown) => {
    const relayed = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
    showToast({ message: relayed ?? localize('com_ui_tars_admin_error'), status: 'error' });
  };

  const onSuccess = (result: TTarsTokenQuotaBatchResult) => {
    const kept = result.kept ?? 0;

    showToast({
      message:
        localize('com_ui_tars_quota_batch_result', {
          0: String(result.user_count),
          1: String(result.created),
          2: String(result.updated),
        }) +
        (kept > 0
          ? localize('com_ui_tars_quota_batch_kept', {
              0: String(kept),
            })
          : ''),
      status: kept > 0 ? 'warning' : 'success',
    });

    onOpenChange(false);
  };

  const batchMutation = useBatchSetTarsTokenQuotasMutation({ onSuccess, onError });

  const toggleProvider = (provider: string) =>
    setProviders((prev) =>
      prev.includes(provider) ? prev.filter((item) => item !== provider) : [...prev, provider],
    );

  const percent = Number(warningPercent);
  const invalid =
    !isValidLimitField(customLimit) ||
    Number.isNaN(percent) ||
    percent < 0 ||
    percent > 100 ||
    (quota == null && (targets.length === 0 || pending.length > 0 || providers.length === 0)) ||
    (quota != null && (quota.user_id == null || quota.provider == null));

  const handleSave = () => {
    const principals: TTarsTokenQuotaBatchInput['principals'] =
      quota == null
        ? targets
            .filter((principal) => !!principal.idOnTheSource)
            .map((principal) => ({
              type: principal.type === PrincipalType.GROUP ? 'group' : 'user',
              id: principal.idOnTheSource as string,
            }))
        : [{ type: 'user', id: String(quota.user_id) }];

    batchMutation.mutate({
      principals,
      providers: quota == null ? providers : [String(quota.provider)],
      custom_limit: Number(fromLimitField(customLimit)),
      reset_type: resetType,
      reset_day: usesResetDay(resetType) ? Number(resetDay) : 1,
      warning_threshold: percent / 100,
      status: active ? QUOTA_STATUS_ON : QUOTA_STATUS_OFF,
      allow_lower: quota != null,
    });
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize(
          quota == null ? 'com_ui_tars_quota_user_add' : 'com_ui_tars_quota_user_edit',
        )}
        showCloseButton={true}
        className="w-11/12 md:max-w-3xl"
        main={
          <div className="space-y-4">
            {quota == null ? (
              <div className="space-y-3">
                <DirectoryPeoplePicker
                  excludeIds={excludeIds}
                  onAddPeople={(principals) =>
                    setAssignees((prev) => mergeUnique(prev, principals))
                  }
                  onPendingChange={setPending}
                  columnHeightClassName="max-h-56"
                />

                <div className="space-y-1.5">
                  <Label>{localize('com_ui_tars_quota_assignees')}</Label>
                  {assignees.length === 0 ? (
                    pending.length === 0 && (
                      <p className="text-status-warning text-xs">
                        {localize('com_ui_tars_quota_assignees_empty')}
                      </p>
                    )
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {assignees.map((principal) => {
                        const isGroup = principal.type === PrincipalType.GROUP;
                        return (
                          <Chip
                            key={keyOf(principal)}
                            tone={isGroup ? 'info' : 'neutral'}
                            className="max-w-[14rem]"
                            leading={
                              isGroup ? (
                                <Users className="size-3 shrink-0" aria-hidden="true" />
                              ) : (
                                <User className="size-3 shrink-0" aria-hidden="true" />
                              )
                            }
                            removeLabel={localize('com_ui_share_remove_selected', {
                              0: principal.name,
                            })}
                            onRemove={() =>
                              setAssignees((prev) =>
                                prev.filter((item) => keyOf(item) !== keyOf(principal)),
                              )
                            }
                          >
                            {principal.name}
                          </Chip>
                        );
                      })}
                    </div>
                  )}
                  {pending.length > 0 && (
                    <p className="text-status-warning text-xs">
                      {localize('com_ui_tars_quota_pending_hint', { 0: String(pending.length) })}
                    </p>
                  )}
                  {hasGroup && (
                    <p className="text-text-secondary text-xs">
                      {localize('com_ui_tars_quota_group_snapshot_hint')}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="border-border-light rounded-lg border px-3 py-2">
                <p className="text-text-secondary text-xs">
                  {localize('com_ui_tars_quota_col_user')}
                </p>
                <p className="text-text-primary text-sm">{personName(quota)}</p>
                <p className="text-text-secondary text-xs">{quota.email ?? '—'}</p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{localize('com_ui_tars_quota_col_provider')}</Label>
                {quota == null ? (
                  <div className="flex flex-wrap items-center gap-3 pt-1.5">
                    {TOKEN_PROVIDERS.map((candidate) => (
                      <label
                        key={candidate}
                        className="text-text-primary flex cursor-pointer items-center gap-1.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={providers.includes(candidate)}
                          onChange={() => toggleProvider(candidate)}
                        />
                        {candidate}
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="pt-1.5">
                    <span className={providerBadgeClass(quota.provider)}>{quota.provider}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="tars-quota-user-status">
                  {localize('com_ui_tars_quota_col_status')}
                </Label>
                <Switch
                  id="tars-quota-user-status"
                  aria-label={localize('com_ui_tars_quota_col_status')}
                  checked={active}
                  onCheckedChange={setActive}
                />
              </div>

              <LimitInput
                id="tars-quota-custom-limit"
                label={localize('com_ui_tars_quota_custom_limit')}
                value={customLimit}
                onChange={setCustomLimit}
              />

              <div className="space-y-1.5">
                <Label htmlFor="tars-quota-user-threshold">
                  {localize('com_ui_tars_quota_warning_threshold')}
                </Label>
                <Input
                  id="tars-quota-user-threshold"
                  type="number"
                  min="0"
                  max="100"
                  value={warningPercent}
                  onChange={(event) => setWarningPercent(event.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tars-quota-user-reset-type">
                  {localize('com_ui_tars_quota_col_reset')}
                </Label>
                <select
                  id="tars-quota-user-reset-type"
                  className={SELECT_CLASS}
                  value={resetType}
                  onChange={(event) => setResetType(event.target.value)}
                >
                  {RESET_TYPES.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {localize(RESET_LABEL_KEYS[candidate])}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tars-quota-user-reset-day">
                  {localize('com_ui_tars_quota_reset_day')}
                </Label>
                <Input
                  id="tars-quota-user-reset-day"
                  type="number"
                  min="1"
                  max="31"
                  disabled={!usesResetDay(resetType)}
                  value={resetDay}
                  onChange={(event) => setResetDay(event.target.value)}
                />
              </div>
            </div>

            {quota != null && (
              <p className="text-text-secondary text-xs">
                {localize('com_ui_tars_quota_used')}
                {': '}
                {(quota.used_amount ?? 0).toLocaleString()}
                {' · '}
                {localize('com_ui_tars_quota_total_used')}
                {': '}
                {(quota.total_used_amount ?? 0).toLocaleString()}
              </p>
            )}
          </div>
        }
        buttons={
          <Button
            variant="submit"
            onClick={handleSave}
            disabled={batchMutation.isLoading || invalid}
          >
            {batchMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
