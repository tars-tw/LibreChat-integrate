import { Fragment, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Input,
  Button,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
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
import type { TTarsMcpServer } from 'librechat-data-provider';
import {
  useTarsMcpServersQuery,
  useTestTarsMcpServerMutation,
  useSyncTarsMcpServerMutation,
  useDeleteTarsMcpServerMutation,
} from '~/data-provider';
import McpServerToolsPanel from './McpServerToolsPanel';
import { useLocalize, useIsTarsAdmin } from '~/hooks';
import { useAuthContext } from '~/hooks/AuthContext';
import McpPermissionsTab from './McpPermissionsTab';
import McpUserToolsTab from './McpUserToolsTab';
import McpServerModal from './McpServerModal';
import McpLogsTab from './McpLogsTab';

const MANAGED_TYPES = new Set(['openapi', 'custom_api', 'external']);

const TYPE_LABEL_KEYS = {
  openapi: 'com_ui_tars_mcp_type_openapi',
  external: 'com_ui_tars_mcp_type_external',
  custom_api: 'com_ui_tars_mcp_type_custom',
} as const;

type SettingsTab = 'mytools' | 'servers' | 'permissions' | 'logs';

/** `mytools` is every pwc_tars account's own catalog; the rest are admin-only. */
const TABS = [
  ['mytools', 'com_ui_tars_mcp_tab_my_tools'],
  ['servers', 'com_ui_tars_mcp_tab_servers'],
  ['permissions', 'com_ui_tars_mcp_tab_permissions'],
  ['logs', 'com_ui_tars_mcp_tab_logs'],
] as const;

const isSettingsTab = (value: string | null): value is SettingsTab =>
  TABS.some(([key]) => key === value);

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
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TTarsMcpServer | null>(null);
  const [deleting, setDeleting] = useState<TTarsMcpServer | null>(null);
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
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-text-primary">
            {localize('com_ui_tars_mcp_settings')}
          </h1>
          {tab === 'servers' && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="icon-sm mr-1" aria-hidden="true" />
              {localize('com_ui_tars_mcp_add_server')}
            </Button>
          )}
        </div>

        {tab === 'servers' && (
          <p className="text-sm text-text-secondary">{localize('com_ui_tars_mcp_settings_hint')}</p>
        )}

        <div
          role="tablist"
          aria-label={localize('com_ui_tars_mcp_settings')}
          className="flex gap-1 border-b border-border-light"
        >
          {TABS.filter(([key]) => key === 'mytools' || isTarsAdmin).map(([key, labelKey]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
                tab === key
                  ? 'border-text-primary font-medium text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {localize(labelKey)}
            </button>
          ))}
        </div>

        {tab === 'mytools' && <McpUserToolsTab />}
        {tab === 'permissions' && <McpPermissionsTab />}
        {tab === 'logs' && <McpLogsTab />}

        {tab === 'servers' && (
          <div className="relative max-w-sm">
            <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={localize('com_ui_tars_mcp_search')}
              className="pl-9"
            />
          </div>
        )}

        {tab === 'servers' && isLoading && (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        )}
        {tab === 'servers' && !isLoading && rows.length === 0 && (
          <p className="py-12 text-center text-sm text-text-secondary">
            {localize('com_ui_tars_mcp_empty')}
          </p>
        )}
        {tab === 'servers' && !isLoading && rows.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border-light">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-surface-secondary text-left text-text-secondary">
                <tr>
                  <th className="w-[22%] px-4 py-2 font-medium">{localize('com_ui_name')}</th>
                  <th className="w-[12%] px-4 py-2 font-medium">
                    {localize('com_ui_tars_mcp_type')}
                  </th>
                  <th className="w-[28%] px-4 py-2 font-medium">
                    {localize('com_ui_description')}
                  </th>
                  <th className="w-[10%] px-4 py-2 font-medium">
                    {localize('com_ui_tars_mcp_tools_count')}
                  </th>
                  <th className="w-[10%] px-4 py-2 font-medium">{localize('com_ui_active')}</th>
                  <th className="w-[18%] px-4 py-2 text-right font-medium">
                    {localize('com_ui_actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((server) => (
                  <Fragment key={server.id}>
                    <tr className="border-t border-border-light hover:bg-surface-hover">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={localize('com_ui_tars_mcp_toggle_tools')}
                            aria-expanded={expandedServerId === server.id}
                            onClick={() =>
                              setExpandedServerId((prev) => (prev === server.id ? null : server.id))
                            }
                            className="rounded p-0.5 text-text-secondary hover:text-text-primary"
                          >
                            {expandedServerId === server.id ? (
                              <ChevronDown className="icon-sm" />
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
                      <td className="px-4 py-2">
                        <span className="inline-block rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
                          {localize(
                            TYPE_LABEL_KEYS[server.type as keyof typeof TYPE_LABEL_KEYS] ??
                              'com_ui_tars_mcp_type_custom',
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-text-secondary">
                        <span className="block truncate" title={server.description ?? ''}>
                          {server.description ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-text-secondary">{server.tool_count ?? 0}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                            server.is_enabled
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                              : 'bg-surface-tertiary text-text-secondary'
                          }`}
                        >
                          {server.is_enabled
                            ? localize('com_ui_active')
                            : localize('com_ui_tars_mcp_disabled')}
                        </span>
                      </td>
                      <td className="px-4 py-2">
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
                        <td colSpan={6} className="bg-surface-secondary px-6 py-2">
                          <McpServerToolsPanel serverId={server.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
    </div>
  );
}
