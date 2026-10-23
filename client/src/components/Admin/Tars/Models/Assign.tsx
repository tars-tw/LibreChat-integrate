import { useMemo, useState, useEffect } from 'react';
import { User, Users, Trash2 } from 'lucide-react';
import { PrincipalType } from 'librechat-data-provider';
import { Chip, Button, Spinner, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TPrincipal, TTarsModelProfile, TTarsPrincipalInfo } from 'librechat-data-provider';
import {
  permissionPrincipalKey,
  TYPE_ICON_COLOR,
} from '~/components/McpSettings/McpPermissionPrincipals';
import { useTarsModelAssigneesQuery, useSaveTarsModelPermissionMutation } from '~/data-provider';
import DirectoryPeoplePicker from '~/components/Sharing/PeoplePicker/DirectoryPeoplePicker';
import { mcpActionClass } from '~/components/McpSettings/actions';
import useFeedback from './useFeedback';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * Title and buttons stay put while the content between them scrolls — one scroll area
 * instead of a fixed-height box nested in the dialog's own scroll, which cut the open
 * picker off under the buttons (same layout as the share dialog).
 */
const DIALOG_LAYOUT = 'flex max-h-[90dvh] w-11/12 flex-col overflow-hidden md:max-w-4xl';

/** Shorter list columns than the share dialog's, so the open picker fits above the assignees. */
const PICKER_COLUMN_HEIGHT = 'max-h-[min(16rem,26dvh)]';

/** Name, type, status and remove — shared by the header and every row. */
const ASSIGNEE_ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_2.5rem] items-center gap-2 px-3 py-2';

/** Users first, then groups (the people picker's order), each by name. */
const byTypeThenName = (a: TTarsPrincipalInfo, b: TTarsPrincipalInfo) =>
  Number(a.principal_type === 'group') - Number(b.principal_type === 'group') ||
  a.name.localeCompare(b.name);

const fromDirectory = (principal: TPrincipal): TTarsPrincipalInfo => ({
  principal_type: principal.type === PrincipalType.GROUP ? 'group' : 'user',
  principal_id: principal.idOnTheSource ?? '',
  name: principal.name ?? '',
  email: principal.email ?? null,
  is_active: true,
});

/** The assignees plus directory picks not already among them. */
const withPeople = (
  assignees: TTarsPrincipalInfo[],
  people: TPrincipal[],
): TTarsPrincipalInfo[] => {
  const known = new Set(assignees.map(permissionPrincipalKey));
  const added = people
    .map(fromDirectory)
    .filter((entry) => entry.principal_id !== '' && !known.has(permissionPrincipalKey(entry)));
  return added.length === 0 ? assignees : [...assignees, ...added];
};

function AssigneeRow({
  assignee,
  onRemove,
}: {
  assignee: TTarsPrincipalInfo;
  onRemove: () => void;
}) {
  const localize = useLocalize();
  const isGroup = assignee.principal_type === 'group';
  const TypeIcon = isGroup ? Users : User;

  return (
    <div className={cn(ASSIGNEE_ROW_GRID, 'border-border-light hover:bg-surface-hover border-b')}>
      <div className="flex min-w-0 items-center gap-2">
        <TypeIcon
          className={cn('icon-sm shrink-0', TYPE_ICON_COLOR[assignee.principal_type])}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <span
            className={cn(
              'block truncate text-sm font-medium',
              assignee.is_active ? 'text-text-primary' : 'text-text-secondary',
            )}
          >
            {assignee.name}
          </span>
          {assignee.email != null && assignee.email !== '' && (
            <span className="text-text-secondary block truncate text-xs">{assignee.email}</span>
          )}
        </div>
      </div>
      <span className="text-text-secondary text-xs">
        {localize(isGroup ? 'com_ui_group' : 'com_ui_user')}
      </span>
      <span>
        <Chip tone={assignee.is_active ? 'success' : 'neutral'}>
          {localize(
            assignee.is_active ? 'com_ui_tars_mcp_principal_active' : 'com_ui_tars_mcp_disabled',
          )}
        </Chip>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${localize('com_ui_tars_mcp_unassign')} ${assignee.name}`}
        title={localize('com_ui_tars_mcp_unassign')}
        className={mcpActionClass('danger')}
      >
        <Trash2 className="icon-sm" />
      </button>
    </div>
  );
}

interface ModelAssignModalProps {
  profile: TTarsModelProfile;
  onClose: () => void;
}

/**
 * Assigns one model to users and groups (`sys_model_permission`). A model nobody is
 * assigned to is open to everyone, so saving an emptied list asks first. Saving
 * overwrites only this model's assignees. Mounts per opening.
 */
export default function ModelAssignModal({ profile, onClose }: ModelAssignModalProps) {
  const localize = useLocalize();
  const { notifySuccess, notifyError } = useFeedback();
  const { data: saved } = useTarsModelAssigneesQuery(profile.id);
  /** `null` until the saved assignees arrive; later refetches keep the admin's edits. */
  const [assignees, setAssignees] = useState<TTarsPrincipalInfo[] | null>(null);
  /** Checked in the picker but not added with its Add button yet — saved all the same. */
  const [pending, setPending] = useState<TPrincipal[]>([]);
  const [confirmingOpen, setConfirmingOpen] = useState(false);

  useEffect(() => {
    if (assignees == null && saved != null) {
      setAssignees(saved);
    }
  }, [assignees, saved]);

  const rows = useMemo(() => [...(assignees ?? [])].sort(byTypeThenName), [assignees]);

  const addPeople = (people: TPrincipal[]) =>
    setAssignees((prev) => withPeople(prev ?? [], people));

  const remove = (key: string) =>
    setAssignees((prev) => (prev ?? []).filter((entry) => permissionPrincipalKey(entry) !== key));

  const saveMutation = useSaveTarsModelPermissionMutation({
    onSuccess: () => {
      notifySuccess(localize('com_ui_tars_models_assign_saved', { name: profile.name }));
      onClose();
    },
    onError: (error: unknown) => {
      setConfirmingOpen(false);
      notifyError(error);
    },
  });

  const toSave = () => withPeople(assignees ?? [], pending);

  const submit = () =>
    saveMutation.mutate({
      modelProfileId: profile.id,
      data: {
        principals: toSave().map((entry) => ({
          principal_type: entry.principal_type,
          principal_id: entry.principal_id,
        })),
      },
    });

  /** Emptying a restricted model widens it to everyone, which is confirmed before saving. */
  const handleSave = () => {
    if (toSave().length === 0 && (saved?.length ?? 0) > 0) {
      setConfirmingOpen(true);
      return;
    }
    submit();
  };

  const isReady = assignees != null;

  return (
    <>
      <OGDialog open onOpenChange={(open) => !open && onClose()}>
        <OGDialogTemplate
          title={localize('com_ui_tars_models_assign_title', { name: profile.name })}
          showCloseButton={true}
          className={DIALOG_LAYOUT}
          mainClassName="min-h-0 flex-1 overflow-y-auto"
          main={
            <div className="space-y-4 pr-1">
              <p className="text-text-secondary text-xs">
                {localize('com_ui_tars_models_assign_hint')}
              </p>

              <section className="space-y-3" aria-labelledby="tars-model-assignees-title">
                <h3
                  id="tars-model-assignees-title"
                  className="text-text-primary text-sm font-medium"
                >
                  {localize('com_ui_tars_mcp_assignees')}
                </h3>
                <DirectoryPeoplePicker
                  onAddPeople={addPeople}
                  onPendingChange={setPending}
                  excludeIds={(assignees ?? []).map((entry) => entry.principal_id)}
                  columnHeightClassName={PICKER_COLUMN_HEIGHT}
                />

                {!isReady && (
                  <div className="flex h-20 items-center justify-center">
                    <Spinner />
                  </div>
                )}
                {isReady && rows.length === 0 && (
                  <p className="border-border-medium text-text-secondary rounded-lg border border-dashed py-6 text-center text-sm">
                    {localize('com_ui_tars_models_assigned_empty')}
                  </p>
                )}
                {isReady && rows.length > 0 && (
                  <div className="border-border-light overflow-x-auto rounded-lg border">
                    <div className="min-w-[28rem] [&>*:last-child]:border-b-0">
                      <div
                        className={cn(
                          ASSIGNEE_ROW_GRID,
                          'border-border-light bg-surface-secondary text-text-secondary border-b text-sm font-medium',
                        )}
                      >
                        <span>{localize('com_ui_name')}</span>
                        <span>{localize('com_ui_tars_mcp_type')}</span>
                        <span>{localize('com_ui_tars_mcp_status')}</span>
                        <span className="sr-only">{localize('com_ui_actions')}</span>
                      </div>
                      {rows.map((assignee) => {
                        const key = permissionPrincipalKey(assignee);
                        return (
                          <AssigneeRow key={key} assignee={assignee} onRemove={() => remove(key)} />
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            </div>
          }
          buttons={
            <Button
              variant="submit"
              onClick={handleSave}
              disabled={!isReady || saveMutation.isLoading}
            >
              {saveMutation.isLoading && !confirmingOpen ? <Spinner /> : localize('com_ui_save')}
            </Button>
          }
        />
      </OGDialog>

      {confirmingOpen && (
        <OGDialog open onOpenChange={(open) => !open && setConfirmingOpen(false)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_models_open_confirm_title')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <p className="text-text-secondary text-sm">
                {localize('com_ui_tars_models_open_confirm', { name: profile.name })}
              </p>
            }
            buttons={
              <Button variant="destructive" onClick={submit} disabled={saveMutation.isLoading}>
                {saveMutation.isLoading ? (
                  <Spinner />
                ) : (
                  localize('com_ui_tars_models_open_confirm_action')
                )}
              </Button>
            }
          />
        </OGDialog>
      )}
    </>
  );
}
