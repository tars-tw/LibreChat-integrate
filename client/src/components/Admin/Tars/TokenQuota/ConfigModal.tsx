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
  TTarsTokenConfig,
  TTarsTokenConfigInput,
  TTarsTokenPrepareData,
} from 'librechat-data-provider';
import {
  RESET_TYPES,
  TOKEN_PROVIDERS,
  RESET_LABEL_KEYS,
  usesResetDay,
  allowedDomainSet,
} from './helpers';
import {
  useCreateTarsTokenConfigMutation,
  useUpdateTarsTokenConfigMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-border-light bg-surface-primary px-3 text-sm text-text-primary disabled:opacity-50';

/** A blank limit means "no ceiling" upstream, which is not the same as zero. */
const toLimit = (value: string): number | null => (value.trim() === '' ? null : Number(value));

const fromLimit = (value: number | null): string => (value == null ? '' : String(value));

interface ConfigForm {
  domainId: string;
  groupId: string;
  provider: string;
  defaultUserLimit: string;
  systemTotalLimit: string;
  resetType: string;
  resetDay: string;
  warningPercent: string;
  active: boolean;
}

const formOf = (config: TTarsTokenConfig | null): ConfigForm => ({
  domainId: config?.domain_id ?? '',
  groupId: config?.user_group_id ?? '',
  provider: config?.provider ?? TOKEN_PROVIDERS[0],
  defaultUserLimit: fromLimit(config?.default_user_limit ?? null),
  systemTotalLimit: fromLimit(config?.system_total_limit ?? null),
  resetType: config?.reset_type ?? 'monthly',
  resetDay: String(config?.reset_day ?? 1),
  warningPercent: String(Math.round((config?.warning_threshold ?? 0.8) * 100)),
  active: config?.is_active ?? true,
});

/**
 * The group-level rule editor. The brain picker is narrowed to what the chosen
 * group's roles actually grant — pwc_tars accepts any pairing, but a rule on a
 * brain the group cannot reach would never fire.
 */
export default function ConfigModal({
  config,
  options,
  open,
  onOpenChange,
}: {
  config: TTarsTokenConfig | null;
  options: TTarsTokenPrepareData | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [form, setForm] = useState<ConfigForm>(() => formOf(config));

  const set = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const groups = useMemo(() => options?.groups ?? [], [options]);
  const domains = useMemo(() => options?.domains ?? [], [options]);

  const availableDomains = useMemo(() => {
    const group = groups.find((candidate) => candidate.id === form.groupId);
    if (group == null) {
      return domains;
    }
    const allowed = allowedDomainSet(group.allowed_domains);
    return domains.filter((domain) => allowed.has(domain.id));
  }, [groups, domains, form.groupId]);

  const onError = (error: unknown) => {
    const relayed = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
    showToast({ message: relayed ?? localize('com_ui_tars_admin_error'), status: 'error' });
  };

  const onSuccess = () => {
    showToast({ message: localize('com_ui_tars_quota_saved'), status: 'success' });
    onOpenChange(false);
  };

  const createMutation = useCreateTarsTokenConfigMutation({ onSuccess, onError });
  const updateMutation = useUpdateTarsTokenConfigMutation({ onSuccess, onError });
  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  const invalid =
    form.groupId === '' ||
    form.domainId === '' ||
    form.provider === '' ||
    Number.isNaN(Number(form.warningPercent));

  const handleSave = () => {
    const input: TTarsTokenConfigInput = {
      domain_id: form.domainId,
      user_group_id: form.groupId,
      provider: form.provider,
      default_user_limit: toLimit(form.defaultUserLimit),
      system_total_limit: toLimit(form.systemTotalLimit),
      reset_type: form.resetType,
      reset_day: usesResetDay(form.resetType) ? Number(form.resetDay) : 1,
      warning_threshold: Number(form.warningPercent) / 100,
      is_active: form.active,
    };
    if (config == null) {
      createMutation.mutate(input);
      return;
    }
    updateMutation.mutate({ id: config.id, data: input });
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize(
          config == null ? 'com_ui_tars_quota_config_add' : 'com_ui_tars_quota_config_edit',
        )}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tars-quota-group">{localize('com_ui_tars_quota_col_group')}</Label>
              <select
                id="tars-quota-group"
                className={SELECT_CLASS}
                value={form.groupId}
                onChange={(event) => {
                  set('groupId', event.target.value);
                  set('domainId', '');
                }}
              >
                <option value="">{localize('com_ui_tars_quota_select_group')}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-quota-domain">{localize('com_ui_tars_quota_col_domain')}</Label>
              <select
                id="tars-quota-domain"
                className={SELECT_CLASS}
                value={form.domainId}
                disabled={form.groupId === ''}
                onChange={(event) => set('domainId', event.target.value)}
              >
                <option value="">{localize('com_ui_tars_quota_select_domain')}</option>
                {availableDomains.map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.name}
                  </option>
                ))}
              </select>
              {form.groupId !== '' && availableDomains.length === 0 && (
                <p className="text-xs text-red-500">
                  {localize('com_ui_tars_quota_no_allowed_domains')}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-quota-provider">
                {localize('com_ui_tars_quota_col_provider')}
              </Label>
              <select
                id="tars-quota-provider"
                className={SELECT_CLASS}
                value={form.provider}
                onChange={(event) => set('provider', event.target.value)}
              >
                {TOKEN_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end justify-between gap-3">
              <Label htmlFor="tars-quota-active">{localize('com_ui_tars_quota_col_status')}</Label>
              <Switch
                id="tars-quota-active"
                aria-label={localize('com_ui_tars_quota_col_status')}
                checked={form.active}
                onCheckedChange={(checked) => set('active', checked)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-quota-user-limit">
                {localize('com_ui_tars_quota_default_user_limit')}
              </Label>
              <Input
                id="tars-quota-user-limit"
                type="number"
                min="0"
                value={form.defaultUserLimit}
                onChange={(event) => set('defaultUserLimit', event.target.value)}
                placeholder={localize('com_ui_tars_quota_unlimited')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-quota-total-limit">
                {localize('com_ui_tars_quota_system_total_limit')}
              </Label>
              <Input
                id="tars-quota-total-limit"
                type="number"
                min="0"
                value={form.systemTotalLimit}
                onChange={(event) => set('systemTotalLimit', event.target.value)}
                placeholder={localize('com_ui_tars_quota_unlimited')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-quota-reset-type">
                {localize('com_ui_tars_quota_col_reset')}
              </Label>
              <select
                id="tars-quota-reset-type"
                className={SELECT_CLASS}
                value={form.resetType}
                onChange={(event) => set('resetType', event.target.value)}
              >
                {RESET_TYPES.map((resetType) => (
                  <option key={resetType} value={resetType}>
                    {localize(RESET_LABEL_KEYS[resetType])}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-quota-reset-day">
                {localize('com_ui_tars_quota_reset_day')}
              </Label>
              <Input
                id="tars-quota-reset-day"
                type="number"
                min="1"
                max="31"
                disabled={!usesResetDay(form.resetType)}
                value={form.resetDay}
                onChange={(event) => set('resetDay', event.target.value)}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tars-quota-threshold">
                {localize('com_ui_tars_quota_warning_threshold')}
              </Label>
              <Input
                id="tars-quota-threshold"
                type="number"
                min="0"
                max="100"
                value={form.warningPercent}
                onChange={(event) => set('warningPercent', event.target.value)}
              />
              <p className="text-xs text-text-secondary">
                {localize('com_ui_tars_quota_warning_hint')}
              </p>
            </div>
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
