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
import type { TTarsRoleInput, TTarsRoleDetail } from 'librechat-data-provider';
import { useCreateTarsRoleMutation, useUpdateTarsRoleMutation } from '~/data-provider';
import { isRoleEnabled, roleMenuKeys } from './helpers';
import { idsToCsv } from '../Users/helpers';
import { useLocalize } from '~/hooks';
import MenuTree from './MenuTree';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20;

type FormState = {
  name: string;
  description: string;
  menuKeys: Set<string>;
  enabled: boolean;
  isDefault: boolean;
};

/** A new role starts with no menus, matching what pwc_tars grants an unconfigured role. */
const toFormState = (role?: TTarsRoleDetail): FormState => ({
  name: role?.name ?? '',
  description: role?.description ?? '',
  menuKeys: new Set(role ? roleMenuKeys(role) : []),
  enabled: role ? isRoleEnabled(role) : true,
  isDefault: role?.is_default_role ?? false,
});

/**
 * Create/edit a role: who it is (name, description), what it opens (menu
 * permissions), then its state. Brains are not edited here; a new role is bound
 * to `createDomainIds` and an edit leaves the stored bindings untouched.
 */
export default function RoleModal({
  open,
  role,
  createDomainIds,
  onOpenChange,
}: {
  open: boolean;
  role?: TTarsRoleDetail;
  createDomainIds?: string;
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

  const handleSave = () => {
    const name = form.name.trim();
    if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
      showToast({ message: localize('com_ui_tars_roles_name_rule'), status: 'error' });
      return;
    }

    const input: TTarsRoleInput = {
      name,
      description: form.description.trim(),
      librechatMenuKeys: idsToCsv([...form.menuKeys]) ?? '',
      isEnabled: form.enabled,
      isDefaultRole: form.isDefault,
    };
    if (isEdit) {
      updateMutation.mutate({ id: role.id, data: input });
      return;
    }
    createMutation.mutate({ ...input, domainIds: createDomainIds });
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={isEdit ? localize('com_ui_tars_roles_edit') : localize('com_ui_tars_roles_add')}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
            <div className="grid shrink-0 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="tars-role-name">{localize('com_ui_tars_roles_name')}</Label>
                <Input
                  id="tars-role-name"
                  className="mt-1"
                  value={form.name}
                  maxLength={MAX_NAME_LENGTH}
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
            </div>

            <MenuTree
              selected={form.menuKeys}
              onChange={(menuKeys) => setForm((prev) => ({ ...prev, menuKeys }))}
            />

            <div className="border-border-light shrink-0 space-y-2 border-t pt-4">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <Label htmlFor="tars-role-enabled">{localize('com_ui_tars_users_enabled')}</Label>
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
                <p className="text-text-secondary text-xs">
                  {localize('com_ui_tars_roles_default_hint')}
                </p>
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
