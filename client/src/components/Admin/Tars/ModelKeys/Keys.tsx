import { useMemo, useState } from 'react';
import { Eye, EyeOff, Save } from 'lucide-react';
import { Button, Input, Label, Spinner, useToastContext } from '@librechat/client';
import type { TTarsSysConfig } from 'librechat-data-provider';
import { useTarsSysConfigsQuery, useUpdateTarsSysConfigMutation } from '~/data-provider';
import { MODEL_KEY_GROUPS, maskKey, readKeyValue } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * The provider credentials pwc_tars keeps in `sys_config`. Editing them here is
 * the same write the system-parameter page performs, so the chat path picks the
 * new key up on its next request; this page only narrows the table down to the
 * credential rows and pairs each provider with its billing key.
 */
export default function Keys() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: sysConfigs = [], isLoading } = useTarsSysConfigsQuery();

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const configByKey = useMemo(() => {
    const map = new Map<string, TTarsSysConfig>();
    for (const config of sysConfigs) {
      map.set(config.key, config);
    }
    return map;
  }, [sysConfigs]);

  const updateMutation = useUpdateTarsSysConfigMutation();

  const storedValue = (key: string) => readKeyValue(configByKey.get(key));
  const draftValue = (key: string) => drafts[key] ?? storedValue(key);

  const changedKeys = useMemo(
    () => Object.keys(drafts).filter((key) => drafts[key] !== readKeyValue(configByKey.get(key))),
    [drafts, configByKey],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const key of changedKeys) {
        await updateMutation.mutateAsync({ key, value: drafts[key].trim() });
      }
      setDrafts({});
      showToast({ message: localize('com_ui_tars_keys_saved'), status: 'success' });
    } catch {
      showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">{localize('com_ui_tars_keys_intro')}</p>

      {MODEL_KEY_GROUPS.map((group) => (
        <section key={group.title} className="rounded-xl border border-border-light">
          <header className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-2">
            <h2 className="text-sm font-medium text-text-primary">{group.title}</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                storedValue(group.fields[0].key) === ''
                  ? 'bg-surface-tertiary text-text-secondary'
                  : 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
              }`}
            >
              {storedValue(group.fields[0].key) === ''
                ? localize('com_ui_tars_keys_unset')
                : localize('com_ui_tars_keys_set')}
            </span>
          </header>

          <div className="space-y-4 p-4">
            {group.fields.map((field) => {
              const missing = !configByKey.has(field.key);
              const value = draftValue(field.key);
              const show = revealed[field.key] === true;
              return (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`tars-key-${field.key}`} className="font-mono text-xs">
                    {field.key}
                  </Label>
                  <p className="text-xs text-text-secondary">{localize(field.hintKey)}</p>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`tars-key-${field.key}`}
                      className="font-mono text-sm"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={missing}
                      value={show ? value : maskKey(value)}
                      onChange={(event) =>
                        setDrafts((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      onFocus={() => setRevealed((prev) => ({ ...prev, [field.key]: true }))}
                      placeholder={localize('com_ui_tars_keys_placeholder')}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={value === ''}
                      onClick={() => setRevealed((prev) => ({ ...prev, [field.key]: !show }))}
                      aria-label={localize(
                        show ? 'com_ui_tars_keys_hide' : 'com_ui_tars_keys_reveal',
                      )}
                      title={localize(show ? 'com_ui_tars_keys_hide' : 'com_ui_tars_keys_reveal')}
                    >
                      {show ? (
                        <EyeOff className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )}
                    </Button>
                  </div>
                  {missing && (
                    <p className="text-xs text-red-500">
                      {localize('com_ui_tars_keys_row_missing')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="flex items-center justify-end gap-3">
        {changedKeys.length > 0 && (
          <span className="text-xs text-text-secondary">
            {localize('com_ui_tars_keys_pending', { 0: String(changedKeys.length) })}
          </span>
        )}
        <Button variant="submit" disabled={saving || changedKeys.length === 0} onClick={handleSave}>
          {saving ? (
            <Spinner className="mr-2 size-4" />
          ) : (
            <Save className="mr-2 size-4" aria-hidden />
          )}
          {localize('com_ui_save')}
        </Button>
      </div>
    </div>
  );
}
