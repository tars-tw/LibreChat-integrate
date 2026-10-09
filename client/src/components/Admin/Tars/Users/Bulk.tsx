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
import { ACTIVE, INACTIVE, csvToIds, idsToCsv } from './helpers';
import { RoleSelect, GroupSelect } from './Fields';
import { useLocalize } from '~/hooks';

const toastError = (localize: ReturnType<typeof useLocalize>, error: unknown): string =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
  localize('com_ui_tars_admin_error');

const NAME_PREVIEW_LIMIT = 5;

/**
 * The accounts a bulk change would leave with neither a role nor a group.
 * pwc_tars's bulk update does not check this, unlike its single-user update.
 * An `undefined` field is one the change leaves untouched.
 */
const findUsersWithoutPermission = (
  users: TTarsUser[],
  change: { roleId?: string; groupIds?: Set<string> },
): TTarsUser[] =>
  users.filter((user) => {
    const hasRole = change.roleId != null ? change.roleId !== '' : user.role_id != null;
    const hasGroup =
      change.groupIds != null ? change.groupIds.size > 0 : csvToIds(user.user_group_id).length > 0;
    return !hasRole && !hasGroup;
  });

const previewNames = (users: TTarsUser[]): string => {
  const names = users.slice(0, NAME_PREVIEW_LIMIT).map((user) => user.username);
  return users.length > NAME_PREVIEW_LIMIT ? `${names.join(', ')}, …` : names.join(', ');
};

/** Applies role / group / status to every selected account in one pwc_tars call. */
export function BulkEditModal({
  users,
  roles,
  groups,
  onSaved,
  onOpenChange,
}: {
  users: TTarsUser[];
  roles: RoleOption[];
  groups: GroupOption[];
  onSaved: () => void;
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
      onSaved();
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
    const touchesOwnAccess = applyRole || (applyStatus && !enabled);
    if (touchesOwnAccess && users.some((user) => user.is_self)) {
      showToast({ message: localize('com_ui_tars_users_bulk_self_blocked'), status: 'error' });
      return;
    }
    const withoutPermission = findUsersWithoutPermission(users, {
      roleId: applyRole ? roleId : undefined,
      groupIds: applyGroup ? groupIds : undefined,
    });
    if (withoutPermission.length > 0) {
      showToast({
        message: localize('com_ui_tars_users_bulk_no_permission_source', {
          count: withoutPermission.length,
          names: previewNames(withoutPermission),
        }),
        status: 'error',
      });
      return;
    }

    /**
     * pwc_tars's bulk update skips a `null` role or group as "leave unchanged",
     * so clearing either one has to be sent as an empty string.
     */
    const updates: TTarsBulkUserUpdate = {};
    if (applyRole) {
      updates.role_id = roleId;
    }
    if (applyGroup) {
      updates.user_group_id = idsToCsv([...groupIds]) ?? '';
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
        className="w-11/12 md:max-w-3xl"
        main={
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_tars_users_selected_count', { count: users.length })}
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-4">
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

              <div className="flex flex-col gap-2 rounded-lg border border-border-light p-3">
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
                  fill={true}
                  onToggle={toggleGroup}
                />
              </div>
            </div>
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
  onSaved,
  onOpenChange,
}: {
  users: TTarsUser[];
  onSaved: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const mutation = useBulkDeleteTarsUsersMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_users_bulk_deleted'), status: 'success' });
      onSaved();
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
