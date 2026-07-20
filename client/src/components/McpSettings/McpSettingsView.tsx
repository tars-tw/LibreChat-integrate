import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Pencil, Trash2, RefreshCw, PlugZap } from 'lucide-react';
import {
  Input,
  Button,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsMcpServer } from 'librechat-data-provider';
import {
  useTarsMcpServersQuery,
  useTestTarsMcpServerMutation,
  useSyncTarsMcpServerMutation,
  useDeleteTarsMcpServerMutation,
} from '~/data-provider';
import { useLocalize, useIsTarsAdmin } from '~/hooks';
import McpServerModal from './McpServerModal';

const MANAGED_TYPES = new Set(['openapi', 'custom_api']);

export default function McpSettingsView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const isTarsAdmin = useIsTarsAdmin();
  const { showToast } = useToastContext();
  const { data: servers = [], isLoading } = useTarsMcpServersQuery();

  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TTarsMcpServer | null>(null);
  const [deleting, setDeleting] = useState<TTarsMcpServer | null>(null);
  const [busyServerId, setBusyServerId] = useState<string | null>(null);

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

  if (!isTarsAdmin) {
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
          <Button onClick={() => setCreating(true)}>
            <Plus className="icon-sm mr-1" aria-hidden="true" />
            {localize('com_ui_tars_mcp_add_server')}
          </Button>
        </div>

        <p className="text-sm text-text-secondary">{localize('com_ui_tars_mcp_settings_hint')}</p>

        <div className="relative max-w-sm">
          <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={localize('com_ui_tars_mcp_search')}
            className="pl-9"
          />
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
                  <tr
                    key={server.id}
                    className="border-t border-border-light hover:bg-surface-hover"
                  >
                    <td className="px-4 py-2">
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
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-block rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
                        {server.type === 'openapi'
                          ? localize('com_ui_tars_mcp_type_openapi')
                          : localize('com_ui_tars_mcp_type_custom')}
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
