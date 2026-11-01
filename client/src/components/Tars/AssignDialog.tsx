import { useMemo, useState, useEffect } from 'react';
import { User, Users, Trash2 } from 'lucide-react';
import { PrincipalType } from 'librechat-data-provider';
import { Chip, Button, Spinner, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TPrincipal, TTarsPrincipalInfo } from 'librechat-data-provider';
import {
  permissionPrincipalKey,
  TYPE_ICON_COLOR,
} from '~/components/McpSettings/McpPermissionPrincipals';
import DirectoryPeoplePicker from '~/components/Sharing/PeoplePicker/DirectoryPeoplePicker';
import { mcpActionClass } from '~/components/McpSettings/actions';
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

/** What a save sends for one assignee. */
export type AssigneeRef = Pick<TTarsPrincipalInfo, 'principal_type' | 'principal_id'>;

export const toAssigneeRef = ({
  principal_type,
  principal_id,
}: TTarsPrincipalInfo): AssigneeRef => ({
  principal_type,
  principal_id,
});

/** Users first, then groups (the people picker's order), each by name. */
export const byTypeThenName = (a: TTarsPrincipalInfo, b: TTarsPrincipalInfo) =>
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

/** The assignees of one grant; disabled ones are marked and can only be removed. */
export function AssigneeTable({
  rows,
  onRemove,
}: {
  rows: TTarsPrincipalInfo[];
  onRemove: (assignee: TTarsPrincipalInfo) => void;
}) {
  const localize = useLocalize();

  return (
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
        {rows.map((assignee) => (
          <AssigneeRow
            key={permissionPrincipalKey(assignee)}
            assignee={assignee}
            onRemove={() => onRemove(assignee)}
          />
        ))}
      </div>
    </div>
  );
}

interface AssignDialogProps {
  title: string;
  hint: string;
  /** Shown while nobody is assigned. */
  emptyText: string;
  /** `undefined` until the saved assignees arrive; later refetches keep the admin's edits. */
  saved?: TTarsPrincipalInfo[];
  isSaving: boolean;
  /** Receives the whole list, people checked in the picker but not yet added included. */
  onSave: (principals: AssigneeRef[]) => void;
  onClose: () => void;
}

/**
 * Edits who a grant is assigned to: the directory picker above the current assignees,
 * saved as one full list. The caller owns the query and the mutation. Mounts per opening.
 */
export default function AssignDialog({
  title,
  hint,
  emptyText,
  saved,
  isSaving,
  onSave,
  onClose,
}: AssignDialogProps) {
  const localize = useLocalize();
  const [assignees, setAssignees] = useState<TTarsPrincipalInfo[] | null>(null);
  /** Checked in the picker but not added with its Add button yet — saved all the same. */
  const [pending, setPending] = useState<TPrincipal[]>([]);

  useEffect(() => {
    if (assignees == null && saved != null) {
      setAssignees(saved);
    }
  }, [assignees, saved]);

  const rows = useMemo(() => [...(assignees ?? [])].sort(byTypeThenName), [assignees]);

  const addPeople = (people: TPrincipal[]) =>
    setAssignees((prev) => withPeople(prev ?? [], people));

  const remove = (assignee: TTarsPrincipalInfo) =>
    setAssignees((prev) =>
      (prev ?? []).filter(
        (entry) => permissionPrincipalKey(entry) !== permissionPrincipalKey(assignee),
      ),
    );

  const isReady = assignees != null;

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={title}
        showCloseButton={true}
        className={DIALOG_LAYOUT}
        mainClassName="min-h-0 flex-1 overflow-y-auto"
        main={
          <div className="space-y-4 pr-1">
            <p className="text-text-secondary text-xs">{hint}</p>

            <section className="space-y-3" aria-labelledby="tars-assignees-title">
              <h3 id="tars-assignees-title" className="text-text-primary text-sm font-medium">
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
                  {emptyText}
                </p>
              )}
              {isReady && rows.length > 0 && <AssigneeTable rows={rows} onRemove={remove} />}
            </section>
          </div>
        }
        buttons={
          <Button
            variant="submit"
            onClick={() => onSave(withPeople(assignees ?? [], pending).map(toAssigneeRef))}
            disabled={!isReady || isSaving}
          >
            {isSaving ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
