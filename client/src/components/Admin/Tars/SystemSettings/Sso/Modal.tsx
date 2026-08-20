import { useState } from 'react';
import { Eye, EyeOff, PlugZap } from 'lucide-react';
import {
  Input,
  Label,
  Button,
  Switch,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsSsoConfig, TTarsLdapConfigInput } from 'librechat-data-provider';
import {
  useCreateTarsSsoConfigMutation,
  useUpdateTarsSsoConfigMutation,
  useTestTarsSsoConnectionMutation,
} from '~/data-provider';
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
});

/**
 * LDAP connection editor. The admin password is never sent back from pwc_tars,
 * so an empty field on an edit means "keep the stored password" and is omitted
 * from the payload rather than saved as a blank.
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
  const updateMutation = useUpdateTarsSsoConfigMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_sso_updated'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });
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

  const isSaving = createMutation.isLoading || updateMutation.isLoading;

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

  const handleSave = () => {
    if (!validate()) {
      return;
    }
    if (isEdit) {
      updateMutation.mutate({ id: config.id, data: buildPayload() });
      return;
    }
    createMutation.mutate(buildPayload());
  };

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
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
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
              <Input
                id="tars-ldap-base-dn"
                className="mt-1"
                placeholder="dc=example,dc=com"
                value={form.baseDn}
                onChange={(e) => set('baseDn', e.target.value)}
              />
              <p className="mt-1 text-xs text-text-secondary">
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
                  <p className="mt-1 text-xs text-text-secondary">
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
            </div>
            <p className="text-xs text-text-secondary">
              {localize('com_ui_tars_sso_whitelist_hint')}
            </p>
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
