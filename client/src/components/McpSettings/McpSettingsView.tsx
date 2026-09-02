import { Fragment, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  PlugZap,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  Tabs,
  Input,
  Button,
  Checkbox,
  Spinner,
  TabsList,
  OGDialog,
  TabsTrigger,
  TabsContent,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsMcpServer } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  useTarsMcpServersQuery,
  useTestTarsMcpServerMutation,
  useSyncTarsMcpServerMutation,
  useDeleteTarsMcpServerMutation,
} from '~/data-provider';
import McpPaginationControls from './McpPaginationControls';
import { useClientPagination } from './useClientPagination';
import McpServerToolsPanel from './McpServerToolsPanel';
import { useLocalize, useIsTarsAdmin } from '~/hooks';
import McpBulkDeleteModal from './McpBulkDeleteModal';
import { useAuthContext } from '~/hooks/AuthContext';
import McpPermissionsTab from './McpPermissionsTab';
import ServerTypeBadge from './ServerTypeBadge';
import McpUserToolsTab from './McpUserToolsTab';
import McpServerModal from './McpServerModal';
import McpLogsTab from './McpLogsTab';

const MANAGED_TYPES = new Set(['openapi', 'custom_api', 'external']);

const MAX_TAG_BADGES = 3;

type SettingsTab = 'mytools' | 'servers' | 'permissions' | 'logs';

/** `?tab=` lets the side panel's TARS card land straight on the user's own catalog. */
const isSettingsTab = (value: string | null): value is SettingsTab =>
  value === 'mytools' || value === 'servers' || value === 'permissions' || value === 'logs';

type ServerStatus = 'disabled' | 'pending' | 'connected';

function serverStatus(server: TTarsMcpServer): ServerStatus {
  if (!server.is_enabled) {
    return 'disabled';
  }
  return (server.tool_count ?? 0) > 0 ? 'connected' : 'pending';
}

const STATUS_STYLES: Record<ServerStatus, string> = {
  disabled: 'bg-surface-tertiary text-text-secondary',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  connected: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
};

const STATUS_LABEL_KEYS: Record<ServerStatus, TranslationKeys> = {
  disabled: 'com_ui_tars_mcp_disabled',
  pending: 'com_ui_tars_mcp_status_pending',
  connected: 'com_ui_tars_mcp_status_connected',
};

/** `TabsContent` ships with `mt-2 p-6`; each panel owns its own spacing instead. */
const TAB_PANEL = 'mt-4 p-0';
/** The shared trigger only shifts the background when active, which reads as barely selected. */
const TAB_TRIGGER = 'data-[state=active]:text-brand-primary';
/** One hint per tab, rendered in a single shared spot so every tab reads consistently. */
const TAB_HINT_KEYS: Record<SettingsTab, TranslationKeys> = {
  mytools: 'com_ui_tars_mcp_my_tools_hint',
  servers: 'com_ui_tars_mcp_settings_hint',
  permissions: 'com_ui_tars_mcp_permissions_hint',
  logs: 'com_ui_tars_mcp_logs_hint',
};

export default function McpSettingsView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const isTarsAdmin = useIsTarsAdmin();
  const { showToast } = useToastContext();
  const [searchParams] = useSearchParams();
  const { data: servers = [], isLoading } = useTarsMcpServersQuery({ enabled: isTarsAdmin });

  /** `?tab=` lets the side panel's TARS card land straight on the user's own
   *  catalog; anything an account may not open falls back to its default tab. */
  const [tab, setTab] = useState<SettingsTab>(() => {
    const requested = searchParams.get('tab');
    if (isSettingsTab(requested) && (isTarsAdmin || requested === 'mytools')) {
      return requested;
    }
    return isTarsAdmin ? 'servers' : 'mytools';
  });
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TTarsMcpServer | null>(null);
  const [deleting, setDeleting] = useState<TTarsMcpServer | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);

  const testMutation = useTestTarsMcpServerMutation();
  const syncMutation = useSyncTarsMcpServerMutation();
  const deleteMutation = useDeleteTarsMcpServerMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_mcp_server_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError: (error) =>
      showToast({ message: (error as Error)?.message ?? 'Error', status: 'error' }),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const managed = servers.filter((server) => MANAGED_TYPES.has(server.type));
    if (!q) {
      return managed;
    }
    return managed.filter((server) =>
      [server.name, server.code, server.description]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(q)),
    );
  }, [servers, search]);

  const {
    page: currentPage,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    pageItems: pageRows,
  } = useClientPagination(rows);

  const selectedServers = useMemo(
    () => rows.filter((server) => selectedIds.has(server.id)),
    [rows, selectedIds],
  );
  const allPageRowsSelected =
    pageRows.length > 0 && pageRows.every((server) => selectedIds.has(server.id));

  const toggleRow = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const toggleAllPageRows = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const server of pageRows) {
        if (allPageRowsSelected) {
          next.delete(server.id);
        } else {
          next.add(server.id);
        }
      }
      return next;
    });

  if (user?.provider !== 'tars') {
    navigate('/c/new', { replace: true });
    return null;
  }

  const handleTest = async (server: TTarsMcpServer) => {
    setBusyServerId(server.id);
    try {
      await testMutation.mutateAsync(server.id);
      showToast({ message: localize('com_ui_tars_mcp_test_success'), status: 'success' });
    } catch (error) {
      showToast({
        message: `${localize('com_ui_tars_mcp_test_failed')}: ${(error as Error)?.message ?? ''}`,
        status: 'error',
      });
    } finally {
      setBusyServerId(null);
    }
  };

  const handleSync = async (server: TTarsMcpServer) => {
    setBusyServerId(server.id);
    try {
      const { result } = await syncMutation.mutateAsync(server.id);
      showToast({
        message: localize('com_ui_tars_mcp_sync_result', {
          created: result?.created ?? 0,
          updated: result?.updated ?? 0,
          deleted: result?.deleted ?? 0,
        }),
        status: 'success',
      });
    } catch (error) {
      showToast({
        message: `${localize('com_ui_tars_mcp_sync_failed')}: ${(error as Error)?.message ?? ''}`,
        status: 'error',
      });
    } finally {
      setBusyServerId(null);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-presentation">
      <div className="mx-auto max-w-7xl space-y-8 p-6">
        <h1 className="text-2xl font-semibold text-text-primary">
          {localize('com_ui_tars_mcp_settings')}
        </h1>

        <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)}>
          <TabsList className="w-fit">
            <TabsTrigger value="mytools" className={TAB_TRIGGER}>
              {localize('com_ui_tars_mcp_tab_my_tools')}
            </TabsTrigger>
            {isTarsAdmin && (
              <TabsTrigger value="servers" className={TAB_TRIGGER}>
                {localize('com_ui_tars_mcp_tab_servers')}
              </TabsTrigger>
            )}
            {isTarsAdmin && (
              <TabsTrigger value="permissions" className={TAB_TRIGGER}>
                {localize('com_ui_tars_mcp_tab_permissions')}
              </TabsTrigger>
            )}
            {isTarsAdmin && (
              <TabsTrigger value="logs" className={TAB_TRIGGER}>
                {localize('com_ui_tars_mcp_tab_logs')}
              </TabsTrigger>
            )}
          </TabsList>

          <p className="mt-4 text-sm text-text-secondary">{localize(TAB_HINT_KEYS[tab])}</p>

          <TabsContent value="mytools" className={TAB_PANEL}>
            <McpUserToolsTab />
          </TabsContent>

          {isTarsAdmin && (
            <TabsContent value="permissions" className={TAB_PANEL}>
              <McpPermissionsTab />
            </TabsContent>
          )}

          {isTarsAdmin && (
            <TabsContent value="logs" className={TAB_PANEL}>
              <McpLogsTab />
            </TabsContent>
          )}

          {isTarsAdmin && (
            <TabsContent value="servers" className={`${TAB_PANEL} space-y-4`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-64 max-w-full">
                    <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                    <Input
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(0);
                      }}
                      placeholder={localize('com_ui_tars_mcp_search')}
                      className="pl-9"
                    />
                  </div>
                  <Button variant="submit" onClick={() => setCreating(true)}>
                    <Plus className="icon-sm mr-1" aria-hidden="true" />
                    {localize('com_ui_tars_mcp_add_server')}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  {selectedIds.size > 0 && (
                    <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>
                      {localize('com_ui_tars_mcp_clear_selection', { count: selectedIds.size })}
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => setBulkDeleting(true)}
                    disabled={selectedIds.size === 0}
                  >
                    {localize('com_ui_tars_mcp_bulk_delete')}
                  </Button>
                </div>
              </div>

              {isLoading && (
                <div className="flex h-40 items-center justify-center">
                  <Spinner />
                </div>
              )}
              {!isLoading && rows.length === 0 && (
                <p className="py-12 text-center text-sm text-text-secondary">
                  {localize('com_ui_tars_mcp_empty')}
                </p>
              )}
              {!isLoading && rows.length > 0 && (
                <>
                  <div className="overflow-x-auto rounded-lg border border-border-light">
                    <table className="w-full min-w-[72rem] table-fixed text-sm">
                      <thead className="bg-surface-secondary text-left text-text-secondary">
                        <tr>
                          <th className="w-10 px-3 py-2">
                            <Checkbox
                              aria-label={localize('com_ui_tars_mcp_select_all')}
                              checked={allPageRowsSelected}
                              onCheckedChange={toggleAllPageRows}
                            />
                          </th>
                          <th className="w-[15%] px-3 py-2 font-medium">
                            {localize('com_ui_name')}
                          </th>
                          <th className="w-[8%] px-3 py-2 font-medium">
                            {localize('com_ui_tars_mcp_type')}
                          </th>
                          <th className="w-[25%] px-3 py-2 font-medium">
                            {localize('com_ui_description')}
                          </th>
                          <th className="w-[7%] px-3 py-2 font-medium">
                            {localize('com_ui_tars_mcp_permissions_tools_header')}
                          </th>
                          <th className="w-[7%] px-3 py-2 font-medium">
                            {localize('com_ui_tars_mcp_priority')}
                          </th>
                          <th className="w-[15%] px-3 py-2 font-medium">
                            {localize('com_ui_tars_mcp_tags')}
                          </th>
                          <th className="w-[9%] px-3 py-2 font-medium">
                            {localize('com_ui_tars_mcp_status')}
                          </th>
                          <th className="w-[11%] px-3 py-2 text-right font-medium">
                            {localize('com_ui_actions')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((server) => {
                          const status = serverStatus(server);
                          const tags = server.tags ?? [];
                          const isSelected = selectedIds.has(server.id);
                          return (
                            <Fragment key={server.id}>
                              <tr
                                className={`border-t border-border-light ${
                                  isSelected
                                    ? 'bg-brand-primary-subtle/40'
                                    : 'hover:bg-surface-hover'
                                }`}
                              >
                                <td className="px-3 py-2">
                                  <Checkbox
                                    aria-label={localize('com_ui_tars_mcp_select_row', {
                                      name: server.name,
                                    })}
                                    checked={isSelected}
                                    onCheckedChange={() => toggleRow(server.id)}
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      aria-label={localize('com_ui_tars_mcp_toggle_tools')}
                                      aria-expanded={expandedServerId === server.id}
                                      onClick={() =>
                                        setExpandedServerId((prev) =>
                                          prev === server.id ? null : server.id,
                                        )
                                      }
                                      className="rounded p-0.5 text-text-secondary hover:text-text-primary"
                                    >
                                      {expandedServerId === server.id ? (
                                        <ChevronDown className="icon-sm text-brand-primary" />
                                      ) : (
                                        <ChevronRight className="icon-sm" />
                                      )}
                                    </button>
                                    <div className="min-w-0">
                                      <span
                                        className="block truncate font-medium text-text-primary"
                                        title={server.name}
                                      >
                                        {server.name}
                                      </span>
                                      {server.code != null && server.code !== '' && (
                                        <span className="block truncate font-mono text-xs text-text-secondary">
                                          {server.code}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2">
                                  <ServerTypeBadge type={server.type} />
                                </td>
                                <td className="px-3 py-2 text-text-secondary">
                                  <span className="block truncate" title={server.description ?? ''}>
                                    {server.description ?? '—'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-text-secondary">
                                  {server.tool_count ?? 0}
                                </td>
                                <td className="px-3 py-2 text-text-secondary">
                                  {server.priority ?? 0}
                                </td>
                                <td className="px-3 py-2">
                                  {tags.length === 0 ? (
                                    <span className="text-text-secondary">—</span>
                                  ) : (
                                    <div className="flex flex-wrap gap-1">
                                      {tags.slice(0, MAX_TAG_BADGES).map((tag) => (
                                        <span
                                          key={tag}
                                          className="inline-block whitespace-nowrap rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                      {tags.length > MAX_TAG_BADGES && (
                                        <span className="inline-block whitespace-nowrap rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
                                          +{tags.length - MAX_TAG_BADGES}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[status]}`}
                                  >
                                    {localize(STATUS_LABEL_KEYS[status])}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex justify-end gap-1">
                                    {busyServerId === server.id ? (
                                      <Spinner className="icon-sm" />
                                    ) : (
                                      <>
                                        <button
                                          type="button"
                                          aria-label={localize('com_ui_tars_mcp_test')}
                                          title={localize('com_ui_tars_mcp_test')}
                                          onClick={() => handleTest(server)}
                                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                                        >
                                          <PlugZap className="icon-sm" />
                                        </button>
                                        <button
                                          type="button"
                                          aria-label={localize('com_ui_tars_mcp_sync')}
                                          title={localize('com_ui_tars_mcp_sync')}
                                          onClick={() => handleSync(server)}
                                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                                        >
                                          <RefreshCw className="icon-sm" />
                                        </button>
                                        <button
                                          type="button"
                                          aria-label={localize('com_ui_edit')}
                                          title={localize('com_ui_edit')}
                                          onClick={() => setEditing(server)}
                                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                                        >
                                          <Pencil className="icon-sm" />
                                        </button>
                                        <button
                                          type="button"
                                          aria-label={localize('com_ui_delete')}
                                          title={localize('com_ui_delete')}
                                          onClick={() => setDeleting(server)}
                                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-red-500"
                                        >
                                          <Trash2 className="icon-sm" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {expandedServerId === server.id && (
                                <tr className="border-t border-border-light">
                                  {/* `w-0` keeps this cell's long tool descriptions from
                                      inflating the table's auto column widths — the row still
                                      renders at the table's real (header-driven) width. */}
                                  <td colSpan={9} className="w-0 bg-surface-secondary px-6 py-2">
                                    <McpServerToolsPanel serverId={server.id} />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <McpPaginationControls
                    labelId="tars-mcp-servers-page-size-label"
                    page={currentPage}
                    pageCount={pageCount}
                    pageSize={pageSize}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                  />
                </>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>

      {(creating || editing != null) && (
        <McpServerModal
          server={editing ?? undefined}
          open={creating || editing != null}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      )}

      {deleting != null && (
        <OGDialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_mcp_delete_server')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <p className="text-sm text-text-secondary">
                {localize('com_ui_tars_mcp_delete_confirm', { name: deleting.name })}
              </p>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(deleting.id)}
                disabled={deleteMutation.isLoading}
              >
                {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      )}

      {bulkDeleting && (
        <McpBulkDeleteModal
          servers={selectedServers}
          onOpenChange={(open) => {
            if (!open) {
              setBulkDeleting(false);
              setSelectedIds(new Set());
            }
          }}
        />
      )}
    </div>
  );
}
