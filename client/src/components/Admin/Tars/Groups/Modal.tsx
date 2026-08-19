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
import type { TTarsUserGroupInput, TTarsUserGroupWithMembers } from 'librechat-data-provider';
import type { GroupRoleOption } from './helpers';
import { useCreateTarsUserGroupMutation, useUpdateTarsUserGroupMutation } from '~/data-provider';
import { GROUP_DISABLED, GROUP_ENABLED, groupRoleIds, isGroupEnabled } from './helpers';
import { idsToCsv } from '../Users/helpers';
import { useLocalize } from '~/hooks';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 30;

type FormState = {
  name: string;
  description: string;
  roleIds: Set<string>;
  enabled: boolean;
};

const toFormState = (group?: TTarsUserGroupWithMembers): FormState => ({
  name: group?.name ?? '',
  description: group?.description ?? '',
  roleIds: new Set(group ? groupRoleIds(group) : []),
  enabled: group ? isGroupEnabled(group) : true,
});

export default function GroupModal({
  open,
  group,
  roles,
  onOpenChange,
}: {
  open: boolean;
  group?: TTarsUserGroupWithMembers;
  roles: GroupRoleOption[];
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = group != null;
  const [form, setForm] = useState<FormState>(() => toFormState(group));

  const onError = (error: unknown) =>
    showToast({
      message:
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        localize('com_ui_tars_admin_error'),
      status: 'error',
    });

  const createMutation = useCreateTarsUserGroupMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_groups_created'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });
  const updateMutation = useUpdateTarsUserGroupMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_groups_updated'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });
  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  const toggleRole = (id: string) =>
    setForm((prev) => {
      const roleIds = new Set(prev.roleIds);
      if (roleIds.has(id)) {
        roleIds.delete(id);
      } else {
        roleIds.add(id);
      }
      return { ...prev, roleIds };
    });

  const handleSave = () => {
    const name = form.name.trim();
    if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
      showToast({ message: localize('com_ui_tars_groups_name_rule'), status: 'error' });
      return;
    }
    if (form.roleIds.size === 0) {
      showToast({ message: localize('com_ui_tars_groups_role_required'), status: 'error' });
      return;
    }

    const input: TTarsUserGroupInput = {
      name,
      description: form.description.trim(),
      roleIds: idsToCsv([...form.roleIds]) ?? undefined,
      status: form.enabled ? GROUP_ENABLED : GROUP_DISABLED,
    };
    if (isEdit) {
      updateMutation.mutate({ id: group.id, data: input });
      return;
    }
    createMutation.mutate(input);
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={isEdit ? localize('com_ui_tars_groups_edit') : localize('com_ui_tars_groups_add')}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <div>
              <Label htmlFor="tars-group-name">{localize('com_ui_tars_groups_name')}</Label>
              <Input
                id="tars-group-name"
                className="mt-1"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="tars-group-description">{localize('com_ui_description')}</Label>
              <Input
                id="tars-group-description"
                className="mt-1"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div>
              <Label>{localize('com_ui_tars_groups_roles')}</Label>
              {roles.length === 0 ? (
                <p className="mt-1 text-sm text-text-secondary">
                  {localize('com_ui_tars_groups_roles_empty')}
                </p>
              ) : (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border-light p-2">
                  {roles.map((role) => (
                    <label
                      key={role.id}
                      className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={form.roleIds.has(String(role.id))}
                        onChange={() => toggleRole(String(role.id))}
                      />
                      <span className="truncate text-text-primary">{role.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-text-secondary">
                {localize('com_ui_tars_groups_roles_hint')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="tars-group-enabled">{localize('com_ui_tars_groups_enabled')}</Label>
              <Switch
                id="tars-group-enabled"
                aria-label={localize('com_ui_tars_groups_enabled')}
                checked={form.enabled}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
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
