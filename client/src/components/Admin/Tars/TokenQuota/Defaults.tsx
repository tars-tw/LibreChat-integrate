import { useState } from 'react';
import { Save } from 'lucide-react';
import { Button, Input, Label, Spinner, useToastContext } from '@librechat/client';
import type { TTarsTokenConfig } from 'librechat-data-provider';
import { useTarsTokenDefaultsQuery, useUpdateTarsTokenDefaultMutation } from '~/data-provider';
import { RESET_TYPES, TOKEN_PROVIDERS, RESET_LABEL_KEYS, usesResetDay } from './helpers';
import { useLocalize } from '~/hooks';

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-border-light bg-surface-primary px-3 text-sm text-text-primary';

interface DefaultForm {
  defaultUserLimit: string;
  systemTotalLimit: string;
  resetType: string;
  resetDay: string;
  warningPercent: string;
}

const formOf = (config: TTarsTokenConfig | undefined): DefaultForm => ({
  defaultUserLimit: config?.default_user_limit == null ? '' : String(config.default_user_limit),
  systemTotalLimit: config?.system_total_limit == null ? '' : String(config.system_total_limit),
  resetType: config?.reset_type ?? 'monthly',
  resetDay: String(config?.reset_day ?? 1),
  warningPercent: String(Math.round((config?.warning_threshold ?? 0.8) * 100)),
});

/** One provider's fallback rule, saved on its own so a slip cannot touch the others. */
function ProviderDefault({
  provider,
  config,
}: {
  provider: string;
  config: TTarsTokenConfig | undefined;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [form, setForm] = useState<DefaultForm>(() => formOf(config));

  const set = <K extends keyof DefaultForm>(key: K, value: DefaultForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const updateMutation = useUpdateTarsTokenDefaultMutation({
    onSuccess: () => showToast({ message: localize('com_ui_tars_quota_saved'), status: 'success' }),
    onError: (error: unknown) => {
      const relayed = (error as { response?: { data?: { error?: string } } })?.response?.data
        ?.error;
      showToast({ message: relayed ?? localize('com_ui_tars_admin_error'), status: 'error' });
    },
  });

  const handleSave = () =>
    updateMutation.mutate({
      provider,
      default_user_limit:
        form.defaultUserLimit.trim() === '' ? null : Number(form.defaultUserLimit),
      system_total_limit:
        form.systemTotalLimit.trim() === '' ? null : Number(form.systemTotalLimit),
      reset_type: form.resetType,
      reset_day: usesResetDay(form.resetType) ? Number(form.resetDay) : 1,
      warning_threshold: Number(form.warningPercent) / 100,
    });

  return (
    <section className="rounded-xl border border-border-light">
      <header className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-2">
        <h3 className="text-sm font-medium text-text-primary">{provider}</h3>
        {config == null && (
          <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
            {localize('com_ui_tars_quota_default_missing')}
          </span>
        )}
      </header>

      <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`tars-default-user-${provider}`}>
            {localize('com_ui_tars_quota_default_user_limit')}
          </Label>
          <Input
            id={`tars-default-user-${provider}`}
            type="number"
            min="0"
            value={form.defaultUserLimit}
            onChange={(event) => set('defaultUserLimit', event.target.value)}
            placeholder={localize('com_ui_tars_quota_unlimited')}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`tars-default-total-${provider}`}>
            {localize('com_ui_tars_quota_system_total_limit')}
          </Label>
          <Input
            id={`tars-default-total-${provider}`}
            type="number"
            min="0"
            value={form.systemTotalLimit}
            onChange={(event) => set('systemTotalLimit', event.target.value)}
            placeholder={localize('com_ui_tars_quota_unlimited')}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`tars-default-threshold-${provider}`}>
            {localize('com_ui_tars_quota_warning_threshold')}
          </Label>
          <Input
            id={`tars-default-threshold-${provider}`}
            type="number"
            min="0"
            max="100"
            value={form.warningPercent}
            onChange={(event) => set('warningPercent', event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`tars-default-reset-${provider}`}>
            {localize('com_ui_tars_quota_col_reset')}
          </Label>
          <select
            id={`tars-default-reset-${provider}`}
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
          <Label htmlFor={`tars-default-day-${provider}`}>
            {localize('com_ui_tars_quota_reset_day')}
          </Label>
          <Input
            id={`tars-default-day-${provider}`}
            type="number"
            min="1"
            max="31"
            disabled={!usesResetDay(form.resetType)}
            value={form.resetDay}
            onChange={(event) => set('resetDay', event.target.value)}
          />
        </div>

        <div className="flex items-end justify-end">
          <Button variant="submit" onClick={handleSave} disabled={updateMutation.isLoading}>
            {updateMutation.isLoading ? (
              <Spinner className="mr-2 size-4" />
            ) : (
              <Save className="mr-2 size-4" aria-hidden />
            )}
            {localize('com_ui_save')}
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * The per-provider fallback rules — config rows with neither brain nor group.
 * pwc_tars falls back to these when no group rule covers a request, so a missing
 * one means that provider is effectively unmetered.
 */
export default function Defaults() {
  const localize = useLocalize();
  const { data: defaults = [], isLoading } = useTarsTokenDefaultsQuery();

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-border-light bg-surface-secondary px-4 py-3 text-sm text-text-secondary">
        {localize('com_ui_tars_quota_defaults_intro')}
      </p>
      {TOKEN_PROVIDERS.map((provider) => (
        <ProviderDefault
          key={provider}
          provider={provider}
          config={defaults.find((config) => config.provider === provider)}
        />
      ))}
    </div>
  );
}
