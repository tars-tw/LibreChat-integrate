import { useRef, useState, useEffect } from 'react';
import { Eye, EyeOff, PlugZap } from 'lucide-react';
import {
  Input,
  Label,
  Button,
  Switch,
  Spinner,
  Dropdown,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type {
  TTarsSsoConfig,
  TTarsAdSyncSummary,
  TTarsLdapConfigInput,
} from 'librechat-data-provider';
import {
  useImportTarsAdDataMutation,
  useTarsAdSyncSummaryMutation,
  useCreateTarsSsoConfigMutation,
  useUpdateTarsSsoConfigMutation,
  useTestTarsSsoConnectionMutation,
} from '~/data-provider';
import {
  LDAP_ATTRIBUTE_PATTERN,
  GROUP_ATTRIBUTE_PRESETS,
  isPresetGroupAttribute,
} from '../helpers';
import useGroupSourceLabel from './source';
import { useLocalize } from '~/hooks';

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

type FormState = {
  name: string;
  address: string;
  port: string;
  baseDn: string;
  searchAttribute: string;
  adminDn: string;
  adminPassword: string;
  enabled: boolean;
  whitelistEnabled: boolean;
  groupSourceEnabled: boolean;
  groupAttributeOption: string;
  customGroupAttribute: string;
};

/** Dropdown value for an attribute outside the presets, typed into its own field. */
const GROUP_ATTRIBUTE_CUSTOM = '__custom__';

/** The stored group source attribute; an empty string means AD group membership. */
const savedGroupAttribute = (config?: TTarsSsoConfig): string => config?.ldap_group_attribute ?? '';

/** Splits a stored group source attribute into the form's switch, preset and custom fields. */
const toGroupSourceFields = (
  attribute: string,
): Pick<FormState, 'groupSourceEnabled' | 'groupAttributeOption' | 'customGroupAttribute'> => {
  if (attribute === '') {
    return {
      groupSourceEnabled: false,
      groupAttributeOption: GROUP_ATTRIBUTE_PRESETS[0],
      customGroupAttribute: '',
    };
  }
  if (isPresetGroupAttribute(attribute)) {
    return { groupSourceEnabled: true, groupAttributeOption: attribute, customGroupAttribute: '' };
  }
  return {
    groupSourceEnabled: true,
    groupAttributeOption: GROUP_ATTRIBUTE_CUSTOM,
    customGroupAttribute: attribute,
  };
};

/** The attribute the form groups by; an empty string keeps AD group membership. */
const formGroupAttribute = (form: FormState): string => {
  if (!form.groupSourceEnabled) {
    return '';
  }
  return form.groupAttributeOption === GROUP_ATTRIBUTE_CUSTOM
    ? form.customGroupAttribute.trim()
    : form.groupAttributeOption;
};

/** A pending group source change on a connection that already imported data. */
type SourceChange = {
  from: string;
  to: string;
  summary: TTarsAdSyncSummary;
};

const toFormState = (config?: TTarsSsoConfig): FormState => ({
  name: config?.ldap_name ?? '',
  address: config?.ldap_server_address ?? '',
  port: config?.ldap_server_port ?? '',
  baseDn: config?.ldap_base_dn ?? '',
  searchAttribute: config?.ldap_search_attribute ?? 'sAMAccountName',
  adminDn: config?.ldap_admin_dn ?? '',
  adminPassword: '',
  enabled: config ? Number(config.status) === 1 : true,
  whitelistEnabled: config?.ldap_enable_whitelist ?? false,
  ...toGroupSourceFields(savedGroupAttribute(config)),
});

/**
 * LDAP connection editor. The admin password is never sent back from pwc_tars,
 * so an empty field on an edit means "keep the stored password" and is omitted
 * from the payload rather than saved as a blank.
 *
 * Changing the group source of a connection that already imported data deletes
 * the groups the old source created, so the save first asks for confirmation and
 * then syncs immediately, mirroring pwc_tars's own settings page.
 */
export default function SsoConfigModal({
  config,
  onOpenChange,
}: {
  config?: TTarsSsoConfig;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = config != null;
  const [form, setForm] = useState<FormState>(() => toFormState(config));
  const [showPassword, setShowPassword] = useState(false);
  const [sourceChange, setSourceChange] = useState<SourceChange | null>(null);
  const [syncEnableUsers, setSyncEnableUsers] = useState(true);
  const groupSourceRef = useRef<HTMLDivElement>(null);
  /**
   * Set only when the admin turns the group source on or picks another option, so the
   * newly shown fields scroll into view while loading a saved source leaves the form alone.
   */
  const revealGroupSource = useRef(false);

  useEffect(() => {
    if (!revealGroupSource.current || !form.groupSourceEnabled) {
      return;
    }
    revealGroupSource.current = false;
    groupSourceRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [form.groupSourceEnabled, form.groupAttributeOption]);
  const groupSourceLabel = useGroupSourceLabel();
  const close = () => onOpenChange(false);

  const onError = (error: unknown) =>
    showToast({
      message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
      status: 'error',
    });

  const createMutation = useCreateTarsSsoConfigMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_sso_created'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });
  const updateMutation = useUpdateTarsSsoConfigMutation({ onError });
  const summaryMutation = useTarsAdSyncSummaryMutation({ onError });
  const importMutation = useImportTarsAdDataMutation();
  const testMutation = useTestTarsSsoConnectionMutation({
    onSuccess: () =>
      showToast({ message: localize('com_ui_tars_sso_test_success'), status: 'success' }),
    onError: (error) =>
      showToast({
        message: `${localize('com_ui_tars_sso_test_failed')}${
          errorMessage(error) ? `: ${errorMessage(error)}` : ''
        }`,
        status: 'error',
      }),
  });

  const isSaving =
    createMutation.isLoading ||
    updateMutation.isLoading ||
    summaryMutation.isLoading ||
    importMutation.isLoading;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const buildPayload = (): TTarsLdapConfigInput => {
    const payload: TTarsLdapConfigInput = {
      ldap_name: form.name.trim(),
      ldap_server_address: form.address.trim(),
      ldap_server_port: form.port.trim(),
      ldap_base_dn: form.baseDn.trim(),
      ldap_search_attribute: form.searchAttribute.trim(),
      ldap_admin_dn: form.adminDn.trim(),
      ldap_enable_whitelist: form.whitelistEnabled,
      ldap_group_attribute: formGroupAttribute(form),
      status: form.enabled ? 1 : 0,
    };
    if (form.adminPassword !== '') {
      payload.ldap_admin_password = form.adminPassword;
    }
    return payload;
  };

  const validate = (): boolean => {
    if (form.address.trim() === '' || form.port.trim() === '' || form.baseDn.trim() === '') {
      showToast({ message: localize('com_ui_tars_sso_required'), status: 'error' });
      return false;
    }
    return true;
  };

  const handleTest = () => {
    if (!validate()) {
      return;
    }
    testMutation.mutate(isEdit ? { config_id: config.id } : buildPayload());
  };

  const validateGroupSource = (attribute: string): boolean => {
    if (form.groupSourceEnabled && attribute === '') {
      showToast({ message: localize('com_ui_tars_sso_group_attribute_required'), status: 'error' });
      return false;
    }
    if (attribute !== '' && !LDAP_ATTRIBUTE_PATTERN.test(attribute)) {
      showToast({
        message: localize('com_ui_tars_sso_group_attribute_invalid', { attribute }),
        status: 'error',
      });
      return false;
    }
    return true;
  };

  const saveEdit = (id: string) =>
    updateMutation.mutate(
      { id, data: buildPayload() },
      {
        onSuccess: () => {
          showToast({ message: localize('com_ui_tars_sso_updated'), status: 'success' });
          close();
        },
      },
    );

  const handleSave = () => {
    const attribute = formGroupAttribute(form);
    if (!validate() || !validateGroupSource(attribute)) {
      return;
    }
    if (!isEdit) {
      createMutation.mutate(buildPayload());
      return;
    }
    const from = savedGroupAttribute(config);
    if (attribute === from) {
      saveEdit(config.id);
      return;
    }
    summaryMutation.mutate(config.id, {
      onSuccess: (summary) => {
        if (summary.synced_user_count === 0 && summary.synced_group_count === 0) {
          saveEdit(config.id);
          return;
        }
        setSyncEnableUsers(true);
        setSourceChange({ from, to: attribute, summary });
      },
    });
  };

  const confirmSourceChange = () => {
    if (!isEdit) {
      return;
    }
    updateMutation.mutate(
      { id: config.id, data: buildPayload() },
      {
        onSuccess: () =>
          importMutation.mutate(
            { id: config.id, enableUsers: syncEnableUsers },
            {
              onSuccess: (result) => {
                showToast({
                  message: result.message || localize('com_ui_tars_sso_import_done'),
                  status: 'success',
                });
                close();
              },
              onError: (error) => {
                showToast({
                  message: localize('com_ui_tars_sso_group_source_sync_failed', {
                    message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
                  }),
                  status: 'error',
                });
                close();
              },
            },
          ),
        onError: () => setSourceChange(null),
      },
    );
  };

  const groupAttributeOptions = [
    ...GROUP_ATTRIBUTE_PRESETS.map((value) => ({
      value,
      label: localize(`com_ui_tars_sso_group_attribute_${value}`),
    })),
    { value: GROUP_ATTRIBUTE_CUSTOM, label: localize('com_ui_tars_sso_group_attribute_custom') },
  ];

  if (sourceChange != null) {
    const { summary } = sourceChange;
    return (
      <OGDialog open={true} onOpenChange={onOpenChange}>
        <OGDialogTemplate
          title={localize('com_ui_tars_sso_group_source_change_title')}
          showCloseButton={true}
          className="w-11/12 md:max-w-lg"
          main={
            <div className="space-y-3 text-sm">
              <p className="text-text-primary">
                {localize('com_ui_tars_sso_group_source_change_message', {
                  from: groupSourceLabel(sourceChange.from),
                  to: groupSourceLabel(sourceChange.to),
                })}
              </p>
              <ul className="text-text-secondary list-disc space-y-1 pl-5">
                <li>
                  {localize('com_ui_tars_sso_group_source_change_groups', {
                    count: summary.synced_group_count,
                  })}
                </li>
                <li>
                  {localize('com_ui_tars_sso_group_source_change_users', {
                    count: summary.synced_user_count,
                  })}
                </li>
                {summary.external_member_count > 0 && (
                  <li>
                    {localize('com_ui_tars_sso_group_source_change_external', {
                      count: summary.external_member_count,
                    })}
                  </li>
                )}
              </ul>
              <p className="text-text-secondary text-xs">
                {localize('com_ui_tars_sso_group_source_change_manual')}
              </p>
              <div className="flex items-center gap-2">
                <Switch
                  id="tars-ldap-source-enable-users"
                  aria-label={localize('com_ui_tars_sso_import_enable')}
                  checked={syncEnableUsers}
                  onCheckedChange={setSyncEnableUsers}
                />
                <label htmlFor="tars-ldap-source-enable-users" className="text-text-primary">
                  {localize('com_ui_tars_sso_import_enable')}
                </label>
              </div>
            </div>
          }
          buttons={
            <>
              <Button variant="outline" onClick={() => setSourceChange(null)} disabled={isSaving}>
                {localize('com_ui_back')}
              </Button>
              <Button variant="destructive" onClick={confirmSourceChange} disabled={isSaving}>
                {isSaving ? <Spinner /> : localize('com_ui_tars_sso_group_source_change_confirm')}
              </Button>
            </>
          }
        />
      </OGDialog>
    );
  }

  const field = (
    id: string,
    labelKey: Parameters<typeof localize>[0],
    key: keyof FormState,
    placeholder?: string,
  ) => (
    <div>
      <Label htmlFor={id}>{localize(labelKey)}</Label>
      <Input
        id={id}
        className="mt-1"
        placeholder={placeholder}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value as FormState[typeof key])}
      />
    </div>
  );

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={isEdit ? localize('com_ui_tars_sso_edit') : localize('com_ui_tars_sso_add')}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="max-h-[70vh] scroll-pb-3 space-y-4 overflow-y-auto pr-1 pb-3">
            <div className="grid gap-3 md:grid-cols-2">
              {field('tars-ldap-name', 'com_ui_tars_sso_name', 'name')}
              {field('tars-ldap-address', 'com_ui_tars_sso_address', 'address', 'ldap.example.com')}
              {field('tars-ldap-port', 'com_ui_tars_sso_port', 'port', '389')}
              {field(
                'tars-ldap-search',
                'com_ui_tars_sso_search_attribute',
                'searchAttribute',
                'sAMAccountName',
              )}
            </div>

            <div>
              <Label htmlFor="tars-ldap-base-dn">{localize('com_ui_tars_sso_base_dn')}</Label>
              {/*
                The hint sits inside the empty field, like a second placeholder; <Input> owns its
                padding, so it hides once there is a value it could overlap. Narrow screens get it
                below instead.
              */}
              <div className="relative mt-1">
                <Input
                  id="tars-ldap-base-dn"
                  placeholder="dc=example,dc=com"
                  aria-describedby="tars-ldap-base-dn-hint"
                  value={form.baseDn}
                  onChange={(e) => set('baseDn', e.target.value)}
                />
                <span
                  id="tars-ldap-base-dn-hint"
                  hidden={form.baseDn !== ''}
                  className="text-text-secondary pointer-events-none absolute top-1/2 right-3 hidden max-w-56 -translate-y-1/2 truncate text-xs sm:block"
                >
                  {localize('com_ui_tars_sso_base_dn_hint')}
                </span>
              </div>
              <p className="text-text-secondary mt-1 text-xs sm:hidden">
                {localize('com_ui_tars_sso_base_dn_hint')}
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {field('tars-ldap-admin-dn', 'com_ui_tars_sso_admin_dn', 'adminDn')}
              <div>
                <Label htmlFor="tars-ldap-admin-password">
                  {localize('com_ui_tars_sso_admin_password')}
                </Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="tars-ldap-admin-password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.adminPassword}
                    onChange={(e) => set('adminPassword', e.target.value)}
                  />
                  <Button
                    variant="outline"
                    aria-label={localize('com_ui_tars_sso_admin_password')}
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? <EyeOff className="icon-sm" /> : <Eye className="icon-sm" />}
                  </Button>
                </div>
                {isEdit && (
                  <p className="text-text-secondary mt-1 text-xs">
                    {localize('com_ui_tars_sso_password_keep')}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Label htmlFor="tars-ldap-enabled">{localize('com_ui_tars_users_enabled')}</Label>
                <Switch
                  id="tars-ldap-enabled"
                  aria-label={localize('com_ui_tars_users_enabled')}
                  checked={form.enabled}
                  onCheckedChange={(checked) => set('enabled', checked)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="tars-ldap-whitelist">
                  {localize('com_ui_tars_sso_whitelist_enable')}
                </Label>
                <Switch
                  id="tars-ldap-whitelist"
                  aria-label={localize('com_ui_tars_sso_whitelist_enable')}
                  checked={form.whitelistEnabled}
                  onCheckedChange={(checked) => set('whitelistEnabled', checked)}
                />
              </div>
              <p className="text-text-secondary text-xs">
                {localize('com_ui_tars_sso_whitelist_hint')}
              </p>
            </div>

            <div className="border-border-light space-y-3 border-t pt-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="tars-ldap-group-source">
                  {localize('com_ui_tars_sso_group_attribute_enable')}
                </Label>
                <Switch
                  id="tars-ldap-group-source"
                  aria-label={localize('com_ui_tars_sso_group_attribute_enable')}
                  checked={form.groupSourceEnabled}
                  onCheckedChange={(checked) => {
                    revealGroupSource.current = checked;
                    set('groupSourceEnabled', checked);
                  }}
                />
              </div>
              <p className="text-text-secondary text-xs">
                {localize('com_ui_tars_sso_group_attribute_hint')}
              </p>
              {form.groupSourceEnabled && (
                <div ref={groupSourceRef} className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label id="tars-ldap-group-attribute-label">
                      {localize('com_ui_tars_sso_group_source')}
                    </Label>
                    <Dropdown
                      value={form.groupAttributeOption}
                      options={groupAttributeOptions}
                      onChange={(value) => {
                        revealGroupSource.current = true;
                        set('groupAttributeOption', value);
                      }}
                      aria-labelledby="tars-ldap-group-attribute-label"
                      className="mt-1 w-full"
                    />
                  </div>
                  {form.groupAttributeOption === GROUP_ATTRIBUTE_CUSTOM && (
                    <div>
                      <Label htmlFor="tars-ldap-group-attribute-custom">
                        {localize('com_ui_tars_sso_group_attribute_custom')}
                      </Label>
                      <Input
                        id="tars-ldap-group-attribute-custom"
                        className="mt-1"
                        placeholder={localize('com_ui_tars_sso_group_attribute_custom_placeholder')}
                        value={form.customGroupAttribute}
                        onChange={(e) => set('customGroupAttribute', e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        }
        buttons={
          <>
            <Button variant="outline" onClick={handleTest} disabled={testMutation.isLoading}>
              {testMutation.isLoading ? (
                <Spinner className="icon-sm mr-1" />
              ) : (
                <PlugZap className="icon-sm mr-1" />
              )}
              {localize('com_ui_tars_sso_test')}
            </Button>
            <Button variant="submit" onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Spinner /> : localize('com_ui_save')}
            </Button>
          </>
        }
      />
    </OGDialog>
  );
}
