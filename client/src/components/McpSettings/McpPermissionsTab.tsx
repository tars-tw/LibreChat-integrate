import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { PrincipalType } from 'librechat-data-provider';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Button,
  Spinner,
  Checkbox,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@librechat/client';
import type {
  TPrincipal,
  TTarsMcpTool,
  TTarsMcpServer,
  TTarsMcpPermission,
  TTarsMcpPrincipalType,
  TPrincipalSearchResult,
  TTarsMcpPermissionPrincipal,
} from 'librechat-data-provider';
import {
  useTarsMcpServerQuery,
  useTarsMcpServersQuery,
  usePrincipalDirectoryQuery,
  useTarsMcpPermissionsQuery,
  useSaveTarsMcpPermissionsMutation,
  useDeleteTarsMcpPermissionsMutation,
  useTarsMcpPermissionPrincipalsQuery,
} from '~/data-provider';
import DirectoryPeoplePicker from '~/components/Sharing/PeoplePicker/DirectoryPeoplePicker';
import { SelectedPrincipalsList } from '~/components/Sharing/PeoplePicker';
import { errorMessage } from '~/components/Admin/Tars/Models/helpers';
import { principalKey } from '~/components/Sharing/shareChanges';
import McpPermissionPrincipals from './McpPermissionPrincipals';
import McpPaginationControls from './McpPaginationControls';
import { useClientPagination } from './useClientPagination';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Selection state: serverId → checked toolId set; empty set = whole server (`mcp_tool_ids: []`). */
type Selection = Map<string, Set<string>>;
type ToggleTool = (
  serverId: string,
  allToolIds: string[],
  toolId: string,
  checked: boolean,
) => void;

const MANAGED_TYPES = new Set(['openapi', 'custom_api', 'external']);
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
          isServerChecked ? 'bg-brand-primary-subtle/40' : 'hover:bg-surface-hover'
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
            <ChevronDown className="icon-sm text-brand-primary shrink-0" />
          ) : (
            <ChevronRight className="icon-sm text-text-secondary shrink-0" />
          )}
          <span
            className={`min-w-0 flex-1 truncate text-sm font-medium ${isServerChecked ? 'text-brand-primary' : 'text-text-primary'}`}
          >
            {server.name}
          </span>
          <span
            className={`shrink-0 text-xs whitespace-nowrap ${isServerChecked ? 'text-brand-primary' : 'text-text-secondary'}`}
          >
            {selectionLabel}
          </span>
        </button>
        <span className="text-text-secondary text-right text-xs">{server.tool_count ?? 0}</span>
      </div>
      {isExpanded && (
        <ul className="bg-surface-secondary space-y-1 px-4 py-2 sm:px-6">
          {isLoading && (
            <li>
              <Spinner className="icon-sm" />
            </li>
          )}
          {!isLoading &&
            tools.map((tool) => {
              const isToolChecked =
                isServerChecked &&
                ((checkedTools?.size ?? 0) === 0 || checkedTools?.has(tool.id) === true);
              return (
                <li key={tool.id}>
                  <div className="hover:bg-surface-hover flex items-start gap-2 rounded-lg px-2 py-2">
                    <Checkbox
                      aria-label={tool.name}
                      checked={isToolChecked}
                      onCheckedChange={(checked) =>
                        onToggleTool(server.id, allToolIds, tool.id, checked === true)
                      }
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs ${
                          isToolChecked
                            ? 'bg-brand-primary-subtle text-brand-primary'
                            : 'bg-surface-tertiary text-text-primary'
                        }`}
                      >
                        {tool.name}
                      </span>
                      {tool.description != null && tool.description !== '' && (
                        <p className="text-text-secondary mt-1 text-xs break-words whitespace-normal">
                          {tool.description}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          {!isLoading && tools.length === 0 && (
            <li className="text-text-secondary text-xs">{localize('com_ui_tars_mcp_no_tools')}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * The tools a server grants right now: none while it is unchecked (`undefined`),
 * every tool when stored as "whole server" (an empty set), else the stored subset.
 */
const grantedToolIds = (current: Set<string> | undefined, allToolIds: string[]): Set<string> => {
  if (current == null) {
    return new Set();
  }
  return new Set(current.size === 0 ? allToolIds : current);
};

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

/** An overview row as a share-dialog principal, enriched from the directory when it is there. */
const toEditTarget = (
  principal: TTarsMcpPermissionPrincipal,
  directoryEntry: TPrincipalSearchResult | undefined,
): TPrincipal => ({
  type: principal.principal_type === 'group' ? PrincipalType.GROUP : PrincipalType.USER,
  name: principal.name,
  email: principal.email ?? undefined,
  source: 'tars',
  idOnTheSource: principal.principal_id,
  avatar: directoryEntry?.avatar,
  memberCount: directoryEntry?.memberCount,
});

/**
 * Assigns MCP servers / tools to pwc_tars users and groups (`sys_mcp_permission`):
 * pick the people like in the share dialog, check servers/tools, and save — a full
 * overwrite of every picked user's and group's grants.
 */
export default function McpPermissionsTab() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: servers = [], isLoading: serversLoading } = useTarsMcpServersQuery();
  const { data: principals = [], isLoading: principalsLoading } =
    useTarsMcpPermissionPrincipalsQuery();
  const { data: directory } = usePrincipalDirectoryQuery();

  const [targets, setTargets] = useState<TPrincipal[]>([]);
  const [selection, setSelection] = useState<Selection>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** The single target whose saved grants are on the tree; later refetches keep the admin's edits. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TTarsMcpPermissionPrincipal | null>(null);
  /** The editor starts folded so the page opens on who already holds grants. */
  const [editorOpen, setEditorOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const managedServers = useMemo(
    () => servers.filter((server) => MANAGED_TYPES.has(server.type)),
    [servers],
  );
  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    pageItems: pageServers,
  } = useClientPagination(managedServers);

  const directoryById = useMemo(() => {
    const map = new Map<string, TPrincipalSearchResult>();
    for (const entry of [...(directory?.users ?? []), ...(directory?.groups ?? [])]) {
      if (entry.idOnTheSource) {
        map.set(entry.idOnTheSource, entry);
      }
    }
    return map;
  }, [directory]);

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

  /** Editing always starts from what is saved, even for the principal already on the tree. */
  const editPrincipal = (principal: TTarsMcpPermissionPrincipal) => {
    setTargets([toEditTarget(principal, directoryById.get(principal.principal_id))]);
    setLoadedKey(null);
    setEditorOpen(true);
    requestAnimationFrame(() =>
      editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
    );
  };

  const cancelEditing = () => {
    updateTargets([]);
    setEditorOpen(false);
  };

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
      const effective = grantedToolIds(next.get(serverId), allToolIds);
      if (checked) {
        effective.add(toolId);
      } else {
        effective.delete(toolId);
      }
      if (effective.size === 0) {
        next.delete(serverId);
      } else if (effective.size === allToolIds.length) {
        next.set(serverId, new Set());
      } else {
        next.set(serverId, effective);
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

  const showError = (error: unknown) =>
    showToast({
      message: errorMessage(error) ?? (error as Error)?.message ?? 'Error',
      status: 'error',
    });

  const saveMutation = useSaveTarsMcpPermissionsMutation({
    onSuccess: () =>
      showToast({ message: localize('com_ui_tars_mcp_permissions_saved'), status: 'success' }),
    onError: showError,
  });

  const deleteMutation = useDeleteTarsMcpPermissionsMutation({
    onSuccess: (_data, target) => {
      showToast({ message: localize('com_ui_tars_mcp_permission_removed'), status: 'success' });
      /** The principal on the tree now holds nothing; its stale checks must not be re-saved. */
      if (`${target.type}-${target.id}` === loadedKey && loadedKey === singleKey) {
        setSelection(new Map());
      }
      setRemoving(null);
    },
    onError: showError,
  });

  const handleSave = () => {
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

  if (serversLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div ref={editorRef} className="border-border-light rounded-lg border">
        <Collapsible open={editorOpen} onOpenChange={setEditorOpen}>
          <CollapsibleTrigger className="w-full text-left">
            <span className="hover:bg-surface-hover flex items-center gap-2 rounded-lg px-4 py-3">
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  'icon-sm text-text-secondary shrink-0 transition-transform duration-200 motion-reduce:transition-none',
                  editorOpen && 'rotate-90',
                )}
              />
              <span className="text-text-primary text-sm font-medium">
                {localize('com_ui_tars_mcp_permission_editor')}
              </span>
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-border-light space-y-6 border-t p-4">
              <section className="space-y-3" aria-labelledby="tars-mcp-assignees-title">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2
                    id="tars-mcp-assignees-title"
                    className="text-text-primary text-sm font-medium"
                  >
                    {localize('com_ui_tars_mcp_assignees')}
                  </h2>
                  <Button
                    variant="submit"
                    onClick={handleSave}
                    disabled={saveMutation.isLoading || isLoadingTarget}
                  >
                    {saveMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
                  </Button>
                </div>
                <DirectoryPeoplePicker
                  onAddPeople={handleAddPeople}
                  excludeIds={targets.map(tarsIdOf)}
                />
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
                  {managedServers.length === 0 && (
                    <p className="text-text-secondary py-8 text-center text-sm">
                      {localize('com_ui_tars_mcp_empty')}
                    </p>
                  )}
                </div>

                {managedServers.length > 0 && (
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
          </CollapsibleContent>
        </Collapsible>
      </div>

      <McpPermissionPrincipals
        principals={principals}
        isLoading={principalsLoading}
        editingKey={loadedKey != null && loadedKey === singleKey ? loadedKey : null}
        onEdit={editPrincipal}
        onCancelEdit={cancelEditing}
        onRemove={setRemoving}
      />

      {removing != null && (
        <OGDialog open={removing != null} onOpenChange={(open) => !open && setRemoving(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_mcp_permission_remove')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <p className="text-text-secondary text-sm">
                {localize('com_ui_tars_mcp_permission_remove_confirm', { name: removing.name })}
              </p>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() =>
                  deleteMutation.mutate({
                    type: removing.principal_type,
                    id: removing.principal_id,
                  })
                }
                disabled={deleteMutation.isLoading}
              >
                {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      )}
    </div>
  );
}
