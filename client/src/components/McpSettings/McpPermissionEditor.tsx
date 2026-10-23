import { useMemo, useState, useEffect, useCallback } from 'react';
import { PrincipalType } from 'librechat-data-provider';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Button,
  Spinner,
  Checkbox,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type {
  TPrincipal,
  TTarsMcpTool,
  TTarsMcpServer,
  TTarsMcpPermission,
  TTarsMcpPrincipalType,
} from 'librechat-data-provider';
import {
  useTarsMcpServerQuery,
  useTarsMcpPermissionsQuery,
  useSaveTarsMcpPermissionsMutation,
} from '~/data-provider';
import DirectoryPeoplePicker from '~/components/Sharing/PeoplePicker/DirectoryPeoplePicker';
import { SelectedPrincipalsList } from '~/components/Sharing/PeoplePicker';
import { errorMessage } from '~/components/Admin/Tars/Models/helpers';
import { principalKey } from '~/components/Sharing/shareChanges';
import McpPaginationControls from './McpPaginationControls';
import { useClientPagination } from './useClientPagination';
import McpToolChecklist from './McpToolChecklist';
import { toggleToolScope } from './grants';
import { useLocalize } from '~/hooks';

/** Selection state: serverId → checked toolId set; empty set = whole server (`mcp_tool_ids: []`). */
type Selection = Map<string, Set<string>>;
type ToggleTool = (
  serverId: string,
  allToolIds: string[],
  toolId: string,
  checked: boolean,
) => void;

/** Checkbox gutter, flexible name column, fixed tool-count column — shared by the header and every row so columns line up. */
const PERMISSIONS_ROW_GRID = 'grid grid-cols-[2.5rem_1fr_5rem] items-center gap-2 px-3 py-2';

function PermissionServerRow({
  server,
  checkedTools,
  isExpanded,
  onToggleExpanded,
  onToggleServer,
  onToggleTool,
}: {
  server: TTarsMcpServer;
  checkedTools: Set<string> | undefined;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onToggleServer: (checked: boolean) => void;
  onToggleTool: ToggleTool;
}) {
  const localize = useLocalize();
  const { data: detail, isLoading } = useTarsMcpServerQuery(isExpanded ? server.id : null);
  const tools: TTarsMcpTool[] = detail?.tools ?? [];
  const isServerChecked = checkedTools != null;
  /** A stored subset is a partial grant (an empty set means the whole server). */
  const isPartial = (checkedTools?.size ?? 0) > 0;
  let serverCheckState: boolean | 'indeterminate' = false;
  if (isServerChecked) {
    serverCheckState = isPartial ? 'indeterminate' : true;
  }
  const allToolIds = tools.map((tool) => tool.id);
  let selectionLabel = '';
  if (isServerChecked) {
    selectionLabel = isPartial
      ? localize('com_ui_tars_mcp_tools_selected', { count: checkedTools?.size ?? 0 })
      : localize('com_ui_tars_mcp_all_tools');
  }

  return (
    <div className="border-border-light border-b last:border-b-0">
      <div
        className={`${PERMISSIONS_ROW_GRID} ${
          isServerChecked ? 'bg-accent-primary/10' : 'hover:bg-surface-hover'
        }`}
      >
        <Checkbox
          aria-label={server.name}
          checked={serverCheckState}
          onCheckedChange={(checked) => onToggleServer(checked === true)}
        />
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
          className="flex min-w-0 items-center gap-2 rounded py-0.5 text-left"
        >
          {isExpanded ? (
            <ChevronDown className="icon-sm text-accent-primary shrink-0" />
          ) : (
            <ChevronRight className="icon-sm text-text-secondary shrink-0" />
          )}
          <span
            className={`min-w-0 flex-1 truncate text-sm font-medium ${isServerChecked ? 'text-accent-primary' : 'text-text-primary'}`}
          >
            {server.name}
          </span>
          <span
            className={`shrink-0 text-xs whitespace-nowrap ${isServerChecked ? 'text-accent-primary' : 'text-text-secondary'}`}
          >
            {selectionLabel}
          </span>
        </button>
        <span className="text-text-secondary text-right text-xs">{server.tool_count ?? 0}</span>
      </div>
      {isExpanded && (
        <McpToolChecklist
          tools={tools}
          isLoading={isLoading}
          scope={checkedTools}
          onToggle={(toolId, checked) => onToggleTool(server.id, allToolIds, toolId, checked)}
        />
      )}
    </div>
  );
}

const toPrincipalType = (principal: TPrincipal): TTarsMcpPrincipalType =>
  principal.type === PrincipalType.GROUP ? 'group' : 'user';

/** Directory principals carry the pwc_tars id as `idOnTheSource`; LibreChat's own `id` is unset. */
const tarsIdOf = (principal: TPrincipal): string => principal.idOnTheSource ?? '';

const toSelection = (rows: TTarsMcpPermission[]): Selection =>
  new Map(
    rows
      .filter((row) => row.is_enabled)
      .map((row) => [row.mcp_server_id, new Set(row.mcp_tool_ids ?? [])]),
  );

interface McpPermissionEditorProps {
  /** Managed servers offered on the tree. */
  servers: TTarsMcpServer[];
  /** Empty for a new assignment; one principal to edit its saved grants. */
  initialTargets: TPrincipal[];
  onClose: () => void;
}

/**
 * Assigns MCP servers / tools to pwc_tars users and groups (`sys_mcp_permission`) in a
 * dialog: pick the people like in the share dialog, check servers/tools, and save — a
 * full overwrite of every picked user's and group's grants. It mounts per opening, so
 * every assignment starts from a clean tree.
 */
export default function McpPermissionEditor({
  servers,
  initialTargets,
  onClose,
}: McpPermissionEditorProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [targets, setTargets] = useState<TPrincipal[]>(initialTargets);
  const [selection, setSelection] = useState<Selection>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** The single target whose saved grants are on the tree; later refetches keep the admin's edits. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  /**
   * Checked in the picker but not added yet. Unlike the server dialog these are not saved
   * implicitly: adding is what loads a principal's grants onto the tree, and saving
   * without that would overwrite their other servers with whatever the tree shows.
   */
  const [pending, setPending] = useState<TPrincipal[]>([]);

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    pageItems: pageServers,
  } = useClientPagination(servers);

  const singleTarget = targets.length === 1 ? targets[0] : null;
  const singleKey = singleTarget ? principalKey(singleTarget) : null;
  const singlePrincipal = useMemo(
    () =>
      singleTarget ? { type: toPrincipalType(singleTarget), id: tarsIdOf(singleTarget) } : null,
    [singleTarget],
  );
  const { data: savedRows, isFetching: savedLoading } = useTarsMcpPermissionsQuery(singlePrincipal);
  const isLoadingTarget = singleKey != null && singleKey !== loadedKey;

  useEffect(() => {
    if (!isLoadingTarget || savedRows == null || savedLoading) {
      return;
    }
    setSelection(toSelection(savedRows));
    setLoadedKey(singleKey);
  }, [isLoadingTarget, savedRows, savedLoading, singleKey]);

  const updateTargets = (next: TPrincipal[]) => {
    setTargets(next);
    /** No target left — the checked servers/tools belonged to the one just removed. */
    if (next.length === 0) {
      setSelection(new Map());
      setLoadedKey(null);
    }
  };

  const handleAddPeople = (people: TPrincipal[]) => {
    const known = new Set(targets.map(principalKey));
    updateTargets([...targets, ...people.filter((person) => !known.has(principalKey(person)))]);
  };

  const removeTarget = (key: string) =>
    updateTargets(targets.filter((target) => principalKey(target) !== key));

  const toggleServer = useCallback((serverId: string, checked: boolean) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (checked) {
        next.set(serverId, new Set());
      } else {
        next.delete(serverId);
      }
      return next;
    });
  }, []);

  const toggleTool = useCallback<ToggleTool>((serverId, allToolIds, toolId, checked) => {
    setSelection((prev) => {
      const next = new Map(prev);
      const scope = toggleToolScope(next.get(serverId), allToolIds, toolId, checked);
      if (scope == null) {
        next.delete(serverId);
      } else {
        next.set(serverId, scope);
      }
      return next;
    });
  }, []);

  const toggleExpanded = (serverId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  };

  const saveMutation = useSaveTarsMcpPermissionsMutation({
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

  const handleSave = () => {
    if (pending.length > 0) {
      showToast({
        message: localize('com_ui_tars_mcp_pending_picks', { count: pending.length }),
        status: 'warning',
      });
      return;
    }
    if (targets.length === 0) {
      showToast({ message: localize('com_ui_tars_mcp_principal_required'), status: 'error' });
      return;
    }
    const idsOf = (type: TTarsMcpPrincipalType) =>
      targets.filter((target) => toPrincipalType(target) === type).map(tarsIdOf);
    saveMutation.mutate({
      user_ids: idsOf('user'),
      user_group_ids: idsOf('group'),
      servers: [...selection.entries()].map(([serverId, toolIds]) => ({
        mcp_server_id: serverId,
        mcp_tool_ids: [...toolIds],
      })),
    });
  };

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_mcp_permission_editor')}
        showCloseButton={true}
        className="w-11/12 md:max-w-5xl"
        main={
          <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
            <section className="space-y-3" aria-labelledby="tars-mcp-assignees-title">
              <h3 id="tars-mcp-assignees-title" className="text-text-primary text-sm font-medium">
                {localize('com_ui_tars_mcp_assignees')}
              </h3>
              <DirectoryPeoplePicker
                onAddPeople={handleAddPeople}
                onPendingChange={setPending}
                excludeIds={targets.map(tarsIdOf)}
              />
              {pending.length > 0 && (
                <p className="text-status-warning text-xs">
                  {localize('com_ui_tars_mcp_pending_picks', { count: pending.length })}
                </p>
              )}
              <SelectedPrincipalsList principles={targets} onRemoveHandler={removeTarget} />
              {targets.length > 1 && (
                <p className="text-status-warning text-xs">
                  {localize('com_ui_tars_mcp_multi_principal_warning')}
                </p>
              )}
            </section>

            <div className="space-y-4">
              <div className="border-border-light relative overflow-hidden rounded-lg border">
                <div
                  className={`${PERMISSIONS_ROW_GRID} border-border-light bg-surface-secondary text-text-secondary border-b text-sm font-medium`}
                >
                  <span aria-hidden="true" />
                  <span className="flex items-center gap-2">
                    {localize('com_ui_name')}
                    {isLoadingTarget && <Spinner className="icon-sm" />}
                  </span>
                  <span className="text-right">
                    {localize('com_ui_tars_mcp_permissions_tools_header')}
                  </span>
                </div>
                {pageServers.map((server) => (
                  <PermissionServerRow
                    key={server.id}
                    server={server}
                    checkedTools={selection.get(server.id)}
                    isExpanded={expanded.has(server.id)}
                    onToggleExpanded={() => toggleExpanded(server.id)}
                    onToggleServer={(checked) => toggleServer(server.id, checked)}
                    onToggleTool={toggleTool}
                  />
                ))}
                {servers.length === 0 && (
                  <p className="text-text-secondary py-8 text-center text-sm">
                    {localize('com_ui_tars_mcp_empty')}
                  </p>
                )}
              </div>

              {servers.length > 0 && (
                <McpPaginationControls
                  labelId="tars-mcp-permissions-page-size-label"
                  page={page}
                  pageCount={pageCount}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              )}
            </div>
          </div>
        }
        buttons={
          <Button
            variant="submit"
            onClick={handleSave}
            disabled={saveMutation.isLoading || isLoadingTarget}
          >
            {saveMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
