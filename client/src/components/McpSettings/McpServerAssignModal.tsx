import { useMemo, useState, useEffect } from 'react';
import { PrincipalType } from 'librechat-data-provider';
import { User, Users, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import {
  Chip,
  Button,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type {
  TPrincipal,
  TTarsMcpTool,
  TTarsMcpServer,
  TTarsMcpServerPermission,
} from 'librechat-data-provider';
import {
  useTarsMcpServerQuery,
  useTarsMcpServerPermissionsQuery,
  useSaveTarsMcpServerPermissionsMutation,
} from '~/data-provider';
import DirectoryPeoplePicker from '~/components/Sharing/PeoplePicker/DirectoryPeoplePicker';
import { permissionPrincipalKey, TYPE_ICON_COLOR } from './McpPermissionPrincipals';
import { errorMessage } from '~/components/Admin/Tars/Models/helpers';
import McpToolChecklist from './McpToolChecklist';
import ServerTypeBadge from './ServerTypeBadge';
import { toggleToolScope } from './grants';
import { mcpActionClass } from './actions';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Expand toggle, name, type, tool scope, status and remove — shared by the header and every row. */
const ASSIGNEE_ROW_GRID =
  'grid grid-cols-[2rem_minmax(0,1fr)_5.5rem_8.5rem_5.5rem_2.5rem] items-center gap-2 px-3 py-2';

/** Users first, then groups (the people picker's order), each by name. */
const byTypeThenName = (a: TTarsMcpServerPermission, b: TTarsMcpServerPermission) =>
  Number(a.principal_type === 'group') - Number(b.principal_type === 'group') ||
  a.name.localeCompare(b.name);

/** A directory pick joins with the whole server; its tools can be narrowed afterwards. */
const fromDirectory = (principal: TPrincipal): TTarsMcpServerPermission => ({
  principal_type: principal.type === PrincipalType.GROUP ? 'group' : 'user',
  principal_id: principal.idOnTheSource ?? '',
  name: principal.name ?? '',
  email: principal.email ?? null,
  is_active: true,
  mcp_tool_ids: [],
  is_enabled: true,
});

/** The assignees plus directory picks not already among them, each joining with the whole server. */
const withPeople = (
  assignees: TTarsMcpServerPermission[],
  people: TPrincipal[],
): TTarsMcpServerPermission[] => {
  const known = new Set(assignees.map(permissionPrincipalKey));
  const added = people
    .map(fromDirectory)
    .filter((entry) => entry.principal_id !== '' && !known.has(permissionPrincipalKey(entry)));
  return added.length === 0 ? assignees : [...assignees, ...added];
};

function AssigneeRow({
  assignee,
  tools,
  toolsLoading,
  isExpanded,
  onToggleExpanded,
  onChangeTools,
  onRemove,
}: {
  assignee: TTarsMcpServerPermission;
  tools: TTarsMcpTool[];
  toolsLoading: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onChangeTools: (toolIds: string[]) => void;
  onRemove: () => void;
}) {
  const localize = useLocalize();
  const isGroup = assignee.principal_type === 'group';
  const TypeIcon = isGroup ? Users : User;
  const isPartial = assignee.mcp_tool_ids.length > 0;
  /** A disabled user or group keeps its grant untouched until it is removed. */
  const canEdit = assignee.is_active;

  const toggleTool = (toolId: string, checked: boolean) => {
    const scope = toggleToolScope(
      new Set(assignee.mcp_tool_ids),
      tools.map((tool) => tool.id),
      toolId,
      checked,
    );
    if (scope != null) {
      onChangeTools([...scope]);
    }
  };

  return (
    <div className="border-border-light border-b last:border-b-0">
      <div className={cn(ASSIGNEE_ROW_GRID, 'hover:bg-surface-hover')}>
        {canEdit ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={isExpanded}
            aria-label={`${localize('com_ui_tars_mcp_toggle_tools')} ${assignee.name}`}
            className="text-text-secondary hover:text-text-primary rounded p-1"
          >
            {isExpanded ? (
              <ChevronDown className="icon-sm text-accent-primary" />
            ) : (
              <ChevronRight className="icon-sm" />
            )}
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
        <div className="flex min-w-0 items-center gap-2">
          <TypeIcon
            className={cn('icon-sm shrink-0', TYPE_ICON_COLOR[assignee.principal_type])}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <span
              className={cn(
                'block truncate text-sm font-medium',
                canEdit ? 'text-text-primary' : 'text-text-secondary',
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
        <span className={cn('text-xs', isPartial ? 'text-accent-primary' : 'text-text-secondary')}>
          {isPartial
            ? localize('com_ui_tars_mcp_tools_selected', { count: assignee.mcp_tool_ids.length })
            : localize('com_ui_tars_mcp_all_tools')}
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
      {canEdit && isExpanded && (
        <div className="bg-surface-secondary">
          {isPartial && (
            <div className="flex justify-end px-4 pt-2 sm:px-6">
              <Button type="button" variant="ghost" size="sm" onClick={() => onChangeTools([])}>
                {localize('com_ui_tars_mcp_use_all_tools')}
              </Button>
            </div>
          )}
          <McpToolChecklist
            tools={tools}
            isLoading={toolsLoading}
            scope={new Set(assignee.mcp_tool_ids)}
            onToggle={toggleTool}
            keepOne
          />
        </div>
      )}
    </div>
  );
}

interface McpServerAssignModalProps {
  server: TTarsMcpServer;
  onClose: () => void;
}

/**
 * Assigns one server to users and groups — the server-centric side of the same
 * `sys_mcp_permission` grants the principal editor writes. Saving overwrites only this
 * server's assignees; their other servers are untouched. Mounts per opening.
 */
export default function McpServerAssignModal({ server, onClose }: McpServerAssignModalProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: saved, isLoading } = useTarsMcpServerPermissionsQuery(server.id);
  const { data: detail, isLoading: toolsLoading } = useTarsMcpServerQuery(server.id);
  const tools: TTarsMcpTool[] = useMemo(() => detail?.tools ?? [], [detail]);
  /** `null` until the saved assignees arrive; later refetches keep the admin's edits. */
  const [assignees, setAssignees] = useState<TTarsMcpServerPermission[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  const updateTools = (key: string, toolIds: string[]) =>
    setAssignees((prev) =>
      (prev ?? []).map((entry) =>
        permissionPrincipalKey(entry) === key ? { ...entry, mcp_tool_ids: toolIds } : entry,
      ),
    );

  const remove = (key: string) =>
    setAssignees((prev) => (prev ?? []).filter((entry) => permissionPrincipalKey(entry) !== key));

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const saveMutation = useSaveTarsMcpServerPermissionsMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_mcp_permissions_saved'), status: 'success' });
      onClose();
    },
    onError: (error: unknown) =>
      showToast({
        message: errorMessage(error) ?? (error as Error)?.message ?? 'Error',
        status: 'error',
      }),
  });

  /** A pick left in the picker joins like an added one: it can only gain this server. */
  const handleSave = () =>
    saveMutation.mutate({
      mcp_server_id: server.id,
      principals: withPeople(assignees ?? [], pending).map((entry) => ({
        principal_type: entry.principal_type,
        principal_id: entry.principal_id,
        mcp_tool_ids: entry.mcp_tool_ids,
      })),
    });

  const isReady = assignees != null;

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_mcp_assign_server_title', { name: server.name })}
        showCloseButton={true}
        className="w-11/12 md:max-w-5xl"
        main={
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-2">
              <ServerTypeBadge type={server.type} />
              <span className="text-text-secondary text-xs">
                {localize('com_ui_tars_mcp_server_tool_count', { count: server.tool_count ?? 0 })}
              </span>
            </div>
            <p className="text-text-secondary text-xs">
              {localize('com_ui_tars_mcp_assign_server_hint')}
            </p>

            <section className="space-y-3" aria-labelledby="tars-mcp-server-assignees-title">
              <h3
                id="tars-mcp-server-assignees-title"
                className="text-text-primary text-sm font-medium"
              >
                {localize('com_ui_tars_mcp_assignees')}
              </h3>
              <DirectoryPeoplePicker
                onAddPeople={addPeople}
                onPendingChange={setPending}
                excludeIds={(assignees ?? []).map((entry) => entry.principal_id)}
              />

              {!isReady && (
                <div className="flex h-20 items-center justify-center">
                  <Spinner />
                </div>
              )}
              {isReady && rows.length === 0 && (
                <p className="border-border-medium text-text-secondary rounded-lg border border-dashed py-6 text-center text-sm">
                  {localize('com_ui_tars_mcp_assigned_empty')}
                </p>
              )}
              {isReady && rows.length > 0 && (
                <div className="border-border-light overflow-x-auto rounded-lg border">
                  <div className="min-w-[40rem]">
                    <div
                      className={cn(
                        ASSIGNEE_ROW_GRID,
                        'border-border-light bg-surface-secondary text-text-secondary border-b text-sm font-medium',
                      )}
                    >
                      <span aria-hidden="true" />
                      <span>{localize('com_ui_name')}</span>
                      <span>{localize('com_ui_tars_mcp_type')}</span>
                      <span>{localize('com_ui_tars_mcp_tool_scope')}</span>
                      <span>{localize('com_ui_tars_mcp_status')}</span>
                      <span className="sr-only">{localize('com_ui_actions')}</span>
                    </div>
                    {rows.map((assignee) => {
                      const key = permissionPrincipalKey(assignee);
                      return (
                        <AssigneeRow
                          key={key}
                          assignee={assignee}
                          tools={tools}
                          toolsLoading={toolsLoading}
                          isExpanded={expanded.has(key)}
                          onToggleExpanded={() => toggleExpanded(key)}
                          onChangeTools={(toolIds) => updateTools(key, toolIds)}
                          onRemove={() => remove(key)}
                        />
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
            disabled={!isReady || isLoading || saveMutation.isLoading}
          >
            {saveMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
