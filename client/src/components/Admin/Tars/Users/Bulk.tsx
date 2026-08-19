import { useState } from 'react';
import {
  Label,
  Button,
  Switch,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsUser, TTarsBulkUserUpdate } from 'librechat-data-provider';
import type { RoleOption, GroupOption } from './helpers';
import { useBulkUpdateTarsUsersMutation, useBulkDeleteTarsUsersMutation } from '~/data-provider';
import { ACTIVE, INACTIVE, idsToCsv } from './helpers';
import { RoleSelect, GroupSelect } from './Fields';
import { useLocalize } from '~/hooks';

const toastError = (localize: ReturnType<typeof useLocalize>, error: unknown): string =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
  localize('com_ui_tars_admin_error');

/** Applies role / group / status to every selected account in one pwc_tars call. */
export function BulkEditModal({
  users,
  roles,
  groups,
  onOpenChange,
}: {
  users: TTarsUser[];
  roles: RoleOption[];
  groups: GroupOption[];
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [applyRole, setApplyRole] = useState(true);
  const [applyGroup, setApplyGroup] = useState(true);
  const [applyStatus, setApplyStatus] = useState(true);
  const [roleId, setRoleId] = useState('');
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState(true);

  const mutation = useBulkUpdateTarsUsersMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_users_bulk_updated'), status: 'success' });
      onOpenChange(false);
    },
    onError: (error) => showToast({ message: toastError(localize, error), status: 'error' }),
  });

  const toggleGroup = (id: string) =>
    setGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const handleSave = () => {
    if (!applyRole && !applyGroup && !applyStatus) {
      showToast({ message: localize('com_ui_tars_users_bulk_field_required'), status: 'error' });
      return;
    }
    if (applyRole && roleId === '' && applyGroup && groupIds.size === 0) {
      showToast({
        message: localize('com_ui_tars_users_role_or_group_required'),
        status: 'error',
      });
      return;
    }

    const updates: TTarsBulkUserUpdate = {};
    if (applyRole) {
      updates.role_id = roleId === '' ? null : roleId;
    }
    if (applyGroup) {
      updates.user_group_id = idsToCsv([...groupIds]);
    }
    if (applyStatus) {
      updates.status = enabled ? ACTIVE : INACTIVE;
    }
    mutation.mutate({ ids: users.map((user) => user.id), updates });
  };

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_users_bulk_edit')}
        showCloseButton={true}
        className="w-11/12 md:max-w-lg"
        main={
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_tars_users_selected_count', { count: users.length })}
            </p>

            <div className="space-y-2 rounded-lg border border-border-light p-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="tars-bulk-apply-role"
                  aria-label={localize('com_ui_tars_users_apply_role')}
                  checked={applyRole}
                  onCheckedChange={setApplyRole}
                />
                <Label htmlFor="tars-bulk-apply-role">
                  {localize('com_ui_tars_users_apply_role')}
                </Label>
              </div>
              <RoleSelect
                id="tars-bulk-role"
                value={roleId}
                roles={roles}
                disabled={!applyRole}
                onChange={setRoleId}
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border-light p-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="tars-bulk-apply-group"
                  aria-label={localize('com_ui_tars_users_apply_group')}
                  checked={applyGroup}
                  onCheckedChange={setApplyGroup}
                />
                <Label htmlFor="tars-bulk-apply-group">
                  {localize('com_ui_tars_users_apply_group')}
                </Label>
              </div>
              <GroupSelect
                groups={groups}
                selected={groupIds}
                disabled={!applyGroup}
                onToggle={toggleGroup}
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border-light p-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="tars-bulk-apply-status"
                  aria-label={localize('com_ui_tars_users_apply_status')}
                  checked={applyStatus}
                  onCheckedChange={setApplyStatus}
                />
                <Label htmlFor="tars-bulk-apply-status">
                  {localize('com_ui_tars_users_apply_status')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="tars-bulk-status"
                  aria-label={localize('com_ui_tars_users_status')}
                  checked={enabled}
                  disabled={!applyStatus}
                  onCheckedChange={setEnabled}
                />
                <Label htmlFor="tars-bulk-status">
                  {enabled
                    ? localize('com_ui_tars_users_enabled')
                    : localize('com_ui_tars_users_disabled')}
                </Label>
              </div>
            </div>

            <details className="rounded-lg border border-border-light p-3">
              <summary className="cursor-pointer text-sm text-text-secondary">
                {localize('com_ui_tars_users_expand_list')}
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm text-text-primary">
                {users.map((user) => (
                  <li key={user.id} className="truncate">
                    {user.username} — {user.email ?? '—'}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={handleSave} disabled={mutation.isLoading}>
            {mutation.isLoading ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}

/** Confirmation for deleting every selected account. */
export function BulkDeleteModal({
  users,
  onOpenChange,
}: {
  users: TTarsUser[];
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const mutation = useBulkDeleteTarsUsersMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_users_bulk_deleted'), status: 'success' });
      onOpenChange(false);
    },
    onError: (error) => showToast({ message: toastError(localize, error), status: 'error' }),
  });

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_users_bulk_delete')}
        showCloseButton={true}
        className="w-11/12 max-w-md"
        main={
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_tars_users_bulk_delete_warning', { count: users.length })}
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border-light p-2 text-sm text-text-primary">
              {users.map((user) => (
                <li key={user.id} className="truncate">
                  {user.username} — {user.email ?? '—'}
                </li>
              ))}
            </ul>
          </div>
        }
        buttons={
          <Button
            variant="destructive"
            onClick={() => mutation.mutate(users.map((user) => user.id))}
            disabled={mutation.isLoading}
          >
            {mutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
          </Button>
        }
      />
    </OGDialog>
  );
}
