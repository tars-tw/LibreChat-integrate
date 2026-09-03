import { useMemo, useState } from 'react';
import {
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
  TTarsTokenUser,
  TTarsTokenUserQuota,
  TTarsTokenQuotaInput,
  TTarsTokenPrepareData,
} from 'librechat-data-provider';
import {
  RESET_TYPES,
  QUOTA_STATUS_ON,
  QUOTA_STATUS_OFF,
  TOKEN_PROVIDERS,
  RESET_LABEL_KEYS,
  usesResetDay,
  allowedDomainSet,
  isActiveQuota,
} from './helpers';
import { useCreateTarsTokenQuotaMutation, useUpdateTarsTokenQuotaMutation } from '~/data-provider';
import LimitInput, { toLimitField, fromLimitField, isValidLimitField } from './LimitInput';
import UserPicker from './UserPicker';
import { useLocalize } from '~/hooks';

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-border-light bg-surface-primary px-3 text-sm text-text-primary disabled:opacity-50';

/**
 * The personal override editor. The user is fixed once a quota exists — pwc_tars
 * keys consumption to the row, so moving it to another account would carry that
 * person's spent tokens with it.
 */
export default function QuotaModal({
  quota,
  options,
  open,
  onOpenChange,
}: {
  quota: TTarsTokenUserQuota | null;
  options: TTarsTokenPrepareData | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [user, setUser] = useState<TTarsTokenUser | null>(null);
  const [domainId, setDomainId] = useState(quota?.domain_id ?? '');
  const [provider, setProvider] = useState(quota?.provider ?? TOKEN_PROVIDERS[0]);
  const [customLimit, setCustomLimit] = useState(() => toLimitField(quota?.custom_limit));
  const [active, setActive] = useState(quota == null ? true : isActiveQuota(quota));
  const [resetType, setResetType] = useState(quota?.reset_type ?? 'monthly');
  const [resetDay, setResetDay] = useState(String(quota?.reset_day ?? 1));
  const [warningPercent, setWarningPercent] = useState(
    String(Math.round((quota?.warning_threshold ?? 0.8) * 100)),
  );

  const domains = useMemo(() => options?.domains ?? [], [options]);
  const availableDomains = useMemo(() => {
    if (user == null) {
      return domains;
    }
    const allowed = allowedDomainSet(user.allowed_domains);
    return domains.filter((domain) => allowed.has(domain.id));
  }, [domains, user]);

  const onError = (error: unknown) => {
    const relayed = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
    showToast({ message: relayed ?? localize('com_ui_tars_admin_error'), status: 'error' });
  };

  const onSuccess = () => {
    showToast({ message: localize('com_ui_tars_quota_saved'), status: 'success' });
    onOpenChange(false);
  };

  const createMutation = useCreateTarsTokenQuotaMutation({ onSuccess, onError });
  const updateMutation = useUpdateTarsTokenQuotaMutation({ onSuccess, onError });
  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  /**
   * A brain is required, not optional: `get_effective_quota` matches a personal
   * override with `domain_id == str(domain_id)`, so a row saved without one can
   * never be found by a request and the ceiling would silently never apply.
   */
  const invalid =
    domainId === '' ||
    !isValidLimitField(customLimit) ||
    Number.isNaN(Number(warningPercent)) ||
    (quota == null && (user == null || provider === ''));

  const handleSave = () => {
    const input: TTarsTokenQuotaInput = {
      domain_id: domainId,
      provider,
      custom_limit: fromLimitField(customLimit),
      reset_type: resetType,
      reset_day: usesResetDay(resetType) ? Number(resetDay) : 1,
      warning_threshold: Number(warningPercent) / 100,
      status: active ? QUOTA_STATUS_ON : QUOTA_STATUS_OFF,
    };
    if (quota == null) {
      createMutation.mutate({
        ...input,
        user_id: user?.id,
        user_group_id: user?.group_id ?? null,
      });
      return;
    }
    updateMutation.mutate({ id: quota.id, data: input });
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize(
          quota == null ? 'com_ui_tars_quota_user_add' : 'com_ui_tars_quota_user_edit',
        )}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="space-y-4">
            {quota == null ? (
              <UserPicker selected={user} onSelect={setUser} />
            ) : (
              <div className="rounded-lg border border-border-light px-3 py-2">
                <p className="text-xs text-text-secondary">
                  {localize('com_ui_tars_quota_col_user')}
                </p>
                <p className="text-sm text-text-primary">{quota.display_name ?? quota.username}</p>
                <p className="text-xs text-text-secondary">{quota.email ?? '—'}</p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tars-quota-user-domain">
                  {localize('com_ui_tars_quota_col_domain')}
                </Label>
                <select
                  id="tars-quota-user-domain"
                  className={SELECT_CLASS}
                  value={domainId}
                  onChange={(event) => setDomainId(event.target.value)}
                >
                  <option value="">{localize('com_ui_tars_quota_select_domain')}</option>
                  {availableDomains.map((domain) => (
                    <option key={domain.id} value={domain.id}>
                      {domain.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tars-quota-user-provider">
                  {localize('com_ui_tars_quota_col_provider')}
                </Label>
                <select
                  id="tars-quota-user-provider"
                  className={SELECT_CLASS}
                  value={provider}
                  disabled={quota != null}
                  onChange={(event) => setProvider(event.target.value)}
                >
                  {TOKEN_PROVIDERS.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate}
                    </option>
                  ))}
                </select>
              </div>

              <LimitInput
                id="tars-quota-custom-limit"
                label={localize('com_ui_tars_quota_custom_limit')}
                value={customLimit}
                onChange={setCustomLimit}
              />

              <div className="flex items-end justify-between gap-3">
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
            </div>

            {quota != null && (
              <p className="text-xs text-text-secondary">
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
          <Button variant="submit" onClick={handleSave} disabled={isSaving || invalid}>
            {isSaving ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
