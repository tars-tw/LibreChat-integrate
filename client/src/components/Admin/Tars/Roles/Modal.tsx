import { useState } from 'react';
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
import type { TTarsDomain, TTarsRoleInput, TTarsRoleDetail } from 'librechat-data-provider';
import { useCreateTarsRoleMutation, useUpdateTarsRoleMutation } from '~/data-provider';
import { isRoleEnabled, roleDomainIds, roleMenuKeys } from './helpers';
import { adminMenuLeafKeys } from '~/components/Nav/Tars/AdminMenu';
import { idsToCsv } from '../Users/helpers';
import { useLocalize } from '~/hooks';
import MenuTree from './MenuTree';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20;

type FormState = {
  name: string;
  description: string;
  domainIds: Set<string>;
  menuKeys: Set<string>;
  enabled: boolean;
  isDefault: boolean;
};

/** A role with no stored key set predates the feature and is treated as "all menus". */
const toFormState = (role?: TTarsRoleDetail): FormState => ({
  name: role?.name ?? '',
  description: role?.description ?? '',
  domainIds: new Set(role ? roleDomainIds(role) : []),
  menuKeys: new Set(role ? (roleMenuKeys(role) ?? adminMenuLeafKeys()) : adminMenuLeafKeys()),
  enabled: role ? isRoleEnabled(role) : true,
  isDefault: role?.is_default_role ?? false,
});

export default function RoleModal({
  open,
  role,
  domains,
  onOpenChange,
}: {
  open: boolean;
  role?: TTarsRoleDetail;
  domains: TTarsDomain[];
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = role != null;
  const [form, setForm] = useState<FormState>(() => toFormState(role));

  const onError = (error: unknown) =>
    showToast({
      message:
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        localize('com_ui_tars_admin_error'),
      status: 'error',
    });

  const createMutation = useCreateTarsRoleMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_roles_created'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });
  const updateMutation = useUpdateTarsRoleMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_roles_updated'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });
  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  const toggleDomain = (id: string) =>
    setForm((prev) => {
      const domainIds = new Set(prev.domainIds);
      if (domainIds.has(id)) {
        domainIds.delete(id);
      } else {
        domainIds.add(id);
      }
      return { ...prev, domainIds };
    });

  const handleSave = () => {
    const name = form.name.trim();
    if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
      showToast({ message: localize('com_ui_tars_roles_name_rule'), status: 'error' });
      return;
    }

    const input: TTarsRoleInput = {
      name,
      description: form.description.trim(),
      domainIds: idsToCsv([...form.domainIds]) ?? '',
      librechatMenuKeys: idsToCsv([...form.menuKeys]) ?? '',
      isEnabled: form.enabled,
      isDefaultRole: form.isDefault,
    };
    if (isEdit) {
      updateMutation.mutate({ id: role.id, data: input });
      return;
    }
    createMutation.mutate(input);
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={isEdit ? localize('com_ui_tars_roles_edit') : localize('com_ui_tars_roles_add')}
        showCloseButton={true}
        className="w-11/12 md:max-w-3xl"
        main={
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="tars-role-name">{localize('com_ui_tars_roles_name')}</Label>
                  <Input
                    id="tars-role-name"
                    className="mt-1"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="tars-role-description">{localize('com_ui_description')}</Label>
                  <Input
                    id="tars-role-description"
                    className="mt-1"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>{localize('com_ui_tars_roles_domains')}</Label>
                  {domains.length === 0 ? (
                    <p className="mt-1 text-sm text-text-secondary">
                      {localize('com_ui_tars_roles_domains_empty')}
                    </p>
                  ) : (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border-light p-2">
                      {domains.map((domain) => (
                        <label
                          key={domain.id}
                          className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={form.domainIds.has(String(domain.id))}
                            onChange={() => toggleDomain(String(domain.id))}
                          />
                          <span className="truncate text-text-primary">{domain.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="tars-role-enabled">
                      {localize('com_ui_tars_users_enabled')}
                    </Label>
                    <Switch
                      id="tars-role-enabled"
                      aria-label={localize('com_ui_tars_users_enabled')}
                      checked={form.enabled}
                      onCheckedChange={(checked) =>
                        setForm((prev) => ({ ...prev, enabled: checked }))
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="tars-role-default">
                      {localize('com_ui_tars_roles_is_default')}
                    </Label>
                    <Switch
                      id="tars-role-default"
                      aria-label={localize('com_ui_tars_roles_is_default')}
                      checked={form.isDefault}
                      onCheckedChange={(checked) =>
                        setForm((prev) => ({ ...prev, isDefault: checked }))
                      }
                    />
                  </div>
                </div>
                {form.isDefault && (
                  <p className="text-xs text-text-secondary">
                    {localize('com_ui_tars_roles_default_hint')}
                  </p>
                )}
              </div>

              <MenuTree
                selected={form.menuKeys}
                onChange={(menuKeys) => setForm((prev) => ({ ...prev, menuKeys }))}
              />
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
