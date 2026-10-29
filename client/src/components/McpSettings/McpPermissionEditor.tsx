import { useMemo, useState } from 'react';
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
  TTarsMcpPermissionSavePayload,
} from 'librechat-data-provider';
import type { Edits, Grants, ToolScope } from './grants';
import {
  unionScope,
  applyEdits,
  toggleToolEdit,
  toolCheckState,
  applyServerEdit,
  serverCheckState,
  toggleServerEdit,
} from './grants';
import {
  useTarsMcpServerQuery,
  useTarsMcpPermissionsQueries,
  useSaveTarsMcpPermissionsMutation,
} from '~/data-provider';
import DirectoryPeoplePicker from '~/components/Sharing/PeoplePicker/DirectoryPeoplePicker';
import { SelectedPrincipalsList } from '~/components/Sharing/PeoplePicker';
import { errorMessage } from '~/components/Admin/Tars/Models/helpers';
import { principalKey } from '~/components/Sharing/shareChanges';
import McpPaginationControls from './McpPaginationControls';
import { useClientPagination } from './useClientPagination';
import McpToolChecklist from './McpToolChecklist';
import { useLocalize } from '~/hooks';

type ToggleTool = (
  serverId: string,
  allToolIds: string[],
  toolId: string,
  checked: boolean,
) => void;

/** Checkbox gutter, flexible name column, fixed tool-count column — shared by the header and every row so columns line up. */
const PERMISSIONS_ROW_GRID = 'grid grid-cols-[2.5rem_1fr_5rem] items-center gap-2 px-3 py-2';

const EMPTY_GRANTS: Grants = new Map();

function PermissionServerRow({
  server,
  scopes,
  isExpanded,
  onToggleExpanded,
  onToggleServer,
  onToggleTool,
}: {
  server: TTarsMcpServer;
  /** Every target's scope on this server with the edits applied; checked only when all hold it. */
  scopes: ToolScope[];
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onToggleServer: (checked: boolean) => void;
  onToggleTool: ToggleTool;
}) {
  const localize = useLocalize();
  const { data: detail, isLoading } = useTarsMcpServerQuery(isExpanded ? server.id : null);
  const tools: TTarsMcpTool[] = detail?.tools ?? [];
  const union = unionScope(scopes);
  const isServerChecked = union != null;
  const allToolIds = tools.map((tool) => tool.id);
  let selectionLabel = '';
  if (union != null) {
    selectionLabel =
      union.size > 0
        ? localize('com_ui_tars_mcp_tools_selected', { count: union.size })
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
          checked={serverCheckState(scopes)}
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
          scope={union}
          stateOf={(toolId) => toolCheckState(scopes, toolId)}
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

const toGrants = (rows: TTarsMcpPermission[]): Grants =>
  new Map(
    rows
      .filter((row) => row.is_enabled)
      .map((row) => [row.mcp_server_id, new Set(row.mcp_tool_ids ?? [])]),
  );

/**
 * What saving writes: each target its own saved grants plus the admin's edits, never
 * another target's. Targets that end up with the same grants share one request.
 */
const toSavePayloads = (
  targets: TPrincipal[],
  owns: Grants[],
  edits: Edits,
): TTarsMcpPermissionSavePayload[] => {
  const byResult = new Map<string, TTarsMcpPermissionSavePayload>();
  targets.forEach((target, index) => {
    const servers = [...applyEdits(owns[index], edits)]
      .map(([serverId, toolIds]) => ({
        mcp_server_id: serverId,
        mcp_tool_ids: [...toolIds].sort(),
      }))
      .sort((a, b) => a.mcp_server_id.localeCompare(b.mcp_server_id));
    const key = JSON.stringify(servers);
    const payload = byResult.get(key) ?? { user_ids: [], user_group_ids: [], servers };
    const ids = toPrincipalType(target) === 'group' ? payload.user_group_ids : payload.user_ids;
    ids.push(tarsIdOf(target));
    byResult.set(key, payload);
  });
  return [...byResult.values()];
};

interface McpPermissionEditorProps {
  /** Managed servers offered on the tree. */
  servers: TTarsMcpServer[];
  /** Empty for a new assignment; one principal to edit its saved grants. */
  initialTargets: TPrincipal[];
  onClose: () => void;
}

/**
 * Assigns MCP servers / tools to pwc_tars users and groups (`sys_mcp_permission`) in a
 * dialog: pick the people like in the share dialog, check servers/tools, and save. Every
 * picked target keeps its own saved grants with the admin's checks and unchecks applied
 * on top, so removing a target takes only its own grants off the tree. It mounts per
 * opening, so every assignment starts from a clean tree.
 */
export default function McpPermissionEditor({
  servers,
  initialTargets,
  onClose,
}: McpPermissionEditorProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [targets, setTargets] = useState<TPrincipal[]>(initialTargets);
  /** The admin's checks and unchecks, kept apart from the targets' grants and applied to every target. */
  const [edits, setEdits] = useState<Edits>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
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

  const principals = useMemo(
    () => targets.map((target) => ({ type: toPrincipalType(target), id: tarsIdOf(target) })),
    [targets],
  );
  const savedQueries = useTarsMcpPermissionsQueries(principals);
  const isLoadingTargets = savedQueries.some((query) => query.data == null);
  /** Each loaded target's saved grants, in `targets` order once none is loading. */
  const owns = savedQueries.flatMap((query) => (query.data == null ? [] : [toGrants(query.data)]));
  /** Before any target is in, the tree shows the edits alone. */
  const shownOwns = owns.length > 0 ? owns : [EMPTY_GRANTS];

  const handleAddPeople = (people: TPrincipal[]) => {
    const known = new Set(targets.map(principalKey));
    setTargets([...targets, ...people.filter((person) => !known.has(principalKey(person)))]);
  };

  const removeTarget = (key: string) =>
    setTargets(targets.filter((target) => principalKey(target) !== key));

  const toggleServer = (serverId: string, checked: boolean) =>
    setEdits((prev) => toggleServerEdit(prev, shownOwns, serverId, checked));

  const toggleTool: ToggleTool = (serverId, allToolIds, toolId, checked) =>
    setEdits((prev) => toggleToolEdit(prev, shownOwns, serverId, allToolIds, toolId, checked));

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

  const saveMutation = useSaveTarsMcpPermissionsMutation();

  const handleSave = async () => {
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
    if (isLoadingTargets) {
      return;
    }
    setIsSaving(true);
    try {
      await Promise.all(
        toSavePayloads(targets, owns, edits).map((payload) => saveMutation.mutateAsync(payload)),
      );
      showToast({ message: localize('com_ui_tars_mcp_permissions_saved'), status: 'success' });
      onClose();
    } catch (error) {
      showToast({
        message: errorMessage(error) ?? (error as Error)?.message ?? 'Error',
        status: 'error',
      });
    } finally {
      setIsSaving(false);
    }
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
                    {isLoadingTargets && <Spinner className="icon-sm" />}
                  </span>
                  <span className="text-right">
                    {localize('com_ui_tars_mcp_permissions_tools_header')}
                  </span>
                </div>
                {pageServers.map((server) => (
                  <PermissionServerRow
                    key={server.id}
                    server={server}
                    scopes={shownOwns.map((own) =>
                      applyServerEdit(own.get(server.id), edits.get(server.id)),
                    )}
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
          <Button variant="submit" onClick={handleSave} disabled={isSaving || isLoadingTargets}>
            {isSaving ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
