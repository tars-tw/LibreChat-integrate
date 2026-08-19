import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
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
import type { TTarsUser, TTarsUserInput, TTarsUserUpdate } from 'librechat-data-provider';
import type { RoleOption, GroupOption } from './helpers';
import {
  useTarsAdWhitelistQuery,
  useCreateTarsUserMutation,
  useUpdateTarsUserMutation,
} from '~/data-provider';
import { ACTIVE, INACTIVE, csvToIds, idsToCsv, isActive } from './helpers';
import { RoleSelect, GroupSelect } from './Fields';
import { useLocalize } from '~/hooks';

const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_USERNAME_LENGTH = 4;
const MIN_PASSWORD_LENGTH = 8;
/** pwc_tars `sso_type_id` 1 is LDAP — the only provider with a user whitelist. */
const LDAP_SSO_TYPES = new Set(['1', 'LDAP', 'ldap']);

type FormState = {
  username: string;
  email: string;
  password: string;
  displayName: string;
  roleId: string;
  groupIds: Set<string>;
  enabled: boolean;
};

const toFormState = (user?: TTarsUser): FormState => ({
  username: user?.username ?? '',
  email: user?.email ?? '',
  password: '',
  displayName: user?.display_name ?? '',
  roleId: user?.role_id != null ? String(user.role_id) : '',
  groupIds: new Set(csvToIds(user?.user_group_id)),
  enabled: user ? isActive(user) : true,
});

export default function UserModal({
  open,
  user,
  roles,
  groups,
  ssoEnabled,
  ssoType,
  onOpenChange,
}: {
  open: boolean;
  user?: TTarsUser;
  roles: RoleOption[];
  groups: GroupOption[];
  ssoEnabled: boolean;
  ssoType: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = user != null;

  const [form, setForm] = useState<FormState>(() => toFormState(user));
  const [adMode, setAdMode] = useState(false);
  const [adFilter, setAdFilter] = useState('');
  const [showAdList, setShowAdList] = useState(false);

  const ldapAvailable = !isEdit && ssoEnabled && LDAP_SSO_TYPES.has(String(ssoType ?? ''));
  const { data: adUsernames = [], isFetching: adLoading } = useTarsAdWhitelistQuery(
    adMode && showAdList,
  );

  const adCandidates = useMemo(() => {
    const query = adFilter.trim().toLowerCase();
    if (!query) {
      return adUsernames;
    }
    return adUsernames.filter((name) => name.toLowerCase().includes(query));
  }, [adUsernames, adFilter]);

  const onError = (error: unknown) =>
    showToast({
      message:
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        localize('com_ui_tars_admin_error'),
      status: 'error',
    });

  const createMutation = useCreateTarsUserMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_users_created'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });
  const updateMutation = useUpdateTarsUserMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_users_updated'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });
  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleGroup = (id: string) =>
    setForm((prev) => {
      const groupIds = new Set(prev.groupIds);
      if (groupIds.has(id)) {
        groupIds.delete(id);
      } else {
        groupIds.add(id);
      }
      return { ...prev, groupIds };
    });

  const fail = (messageKey: Parameters<typeof localize>[0]) => {
    showToast({ message: localize(messageKey), status: 'error' });
    return false;
  };

  /** An account must end up with a permission source: its own role, a group, or both. */
  const hasPermissionSource = () => form.roleId !== '' || form.groupIds.size > 0;

  const validate = (): boolean => {
    if (!hasPermissionSource()) {
      return fail('com_ui_tars_users_role_or_group_required');
    }
    if (isEdit) {
      return true;
    }
    const username = form.username.trim();
    if (username.length < MIN_USERNAME_LENGTH || !USERNAME_PATTERN.test(username)) {
      return fail('com_ui_tars_users_username_rule');
    }
    if (adMode) {
      return true;
    }
    if (!EMAIL_PATTERN.test(form.email.trim())) {
      return fail('com_ui_tars_users_email_invalid');
    }
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      return fail('com_ui_tars_users_password_min');
    }
    return true;
  };

  const handleSave = () => {
    if (!validate()) {
      return;
    }

    if (isEdit) {
      const update: TTarsUserUpdate = {
        email: form.email.trim(),
        display_name: form.displayName.trim(),
        role_id: form.roleId === '' ? null : form.roleId,
        user_group_id: idsToCsv([...form.groupIds]),
        status: form.enabled ? ACTIVE : INACTIVE,
      };
      updateMutation.mutate({ id: user.id, data: update });
      return;
    }

    const input: TTarsUserInput = {
      username: form.username.trim(),
      display_name: form.displayName.trim(),
      role_id: form.roleId === '' ? null : form.roleId,
      user_group_id: idsToCsv([...form.groupIds]),
      status: adMode || form.enabled ? ACTIVE : INACTIVE,
    };
    if (adMode) {
      input.is_sso_user = true;
    } else {
      input.email = form.email.trim();
      input.password = form.password;
    }
    createMutation.mutate(input);
  };

  const handleAdModeChange = (checked: boolean) => {
    setAdMode(checked);
    setShowAdList(false);
    setAdFilter('');
    setForm((prev) => ({ ...prev, username: '', email: '', password: '' }));
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={isEdit ? localize('com_ui_tars_users_edit') : localize('com_ui_tars_users_add')}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="tars-user-username">{localize('com_ui_tars_users_username')}</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="tars-user-username"
                    value={form.username}
                    disabled={isEdit}
                    onChange={(e) => set('username', e.target.value)}
                  />
                  {adMode && (
                    <Button
                      variant="outline"
                      aria-label={localize('com_ui_tars_users_ad_search')}
                      onClick={() => setShowAdList(true)}
                    >
                      <Search className="icon-sm" />
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Label htmlFor="tars-user-display-name">
                  {localize('com_ui_tars_users_display_name')}
                </Label>
                <Input
                  id="tars-user-display-name"
                  className="mt-1"
                  value={form.displayName}
                  onChange={(e) => set('displayName', e.target.value)}
                />
              </div>
            </div>

            {adMode && showAdList && (
              <div className="rounded-lg border border-border-light p-3">
                <Label htmlFor="tars-user-ad-filter">
                  {localize('com_ui_tars_users_ad_select')}
                </Label>
                <Input
                  id="tars-user-ad-filter"
                  className="mt-1"
                  value={adFilter}
                  onChange={(e) => setAdFilter(e.target.value)}
                />
                <div className="mt-2 max-h-40 overflow-y-auto">
                  {adLoading && <Spinner className="icon-sm" />}
                  {!adLoading && adCandidates.length === 0 && (
                    <p className="py-2 text-sm text-text-secondary">
                      {localize('com_ui_tars_users_ad_empty')}
                    </p>
                  )}
                  {!adLoading &&
                    adCandidates.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          set('username', name);
                          setShowAdList(false);
                        }}
                        className="block w-full rounded px-2 py-1 text-left text-sm text-text-primary hover:bg-surface-hover"
                      >
                        {name}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {!adMode && (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="tars-user-email">{localize('com_auth_email')}</Label>
                  <Input
                    id="tars-user-email"
                    type="email"
                    className="mt-1"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                  />
                </div>
                {!isEdit && (
                  <div>
                    <Label htmlFor="tars-user-password">
                      {localize('com_ui_tars_users_password')}
                    </Label>
                    <Input
                      id="tars-user-password"
                      type="password"
                      className="mt-1"
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <RoleSelect
                id="tars-user-role"
                value={form.roleId}
                roles={roles}
                onChange={(value) => set('roleId', value)}
              />
              <GroupSelect groups={groups} selected={form.groupIds} onToggle={toggleGroup} />
            </div>

            <div className="flex flex-wrap items-center gap-6">
              {!adMode && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="tars-user-enabled">{localize('com_ui_tars_users_enabled')}</Label>
                  <Switch
                    id="tars-user-enabled"
                    aria-label={localize('com_ui_tars_users_enabled')}
                    checked={form.enabled}
                    onCheckedChange={(checked) => set('enabled', checked)}
                  />
                </div>
              )}
              {ldapAvailable && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="tars-user-ad-mode">{localize('com_ui_tars_users_ad_mode')}</Label>
                  <Switch
                    id="tars-user-ad-mode"
                    aria-label={localize('com_ui_tars_users_ad_mode')}
                    checked={adMode}
                    onCheckedChange={handleAdModeChange}
                  />
                </div>
              )}
            </div>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
