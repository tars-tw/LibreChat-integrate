import { useMemo, useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { Input, Button, Spinner } from '@librechat/client';
import { useTarsMcpServersQuery, useTarsMcpLogsQuery } from '~/data-provider';
import McpPaginationControls from './McpPaginationControls';
import { useClientPagination } from './useClientPagination';
import { useLocalize } from '~/hooks';

const LOGS_LIMIT = 100;

/** Read-only view over pwc_tars `mcp_logs` (newest first, client-side keyword search). */
export default function McpLogsTab() {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const { data: servers = [] } = useTarsMcpServersQuery();
  const {
    data: logs = [],
    isLoading,
    refetch,
    isFetching,
  } = useTarsMcpLogsQuery({ limit: LOGS_LIMIT });

  const serverNames = useMemo(
    () => new Map(servers.map((server) => [server.id, server.name])),
    [servers],
  );

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return logs;
    }
    return logs.filter((log) =>
      [
        log.tool_name,
        serverNames.get(log.mcp_server_id) ?? log.mcp_server_id,
        log.sys_user_id,
        log.status,
        log.conversation_id,
        log.error_message,
      ]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(q)),
    );
  }, [logs, search, serverNames]);

  const {
    page: currentPage,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    pageItems: pageLogs,
  } = useClientPagination(filteredLogs);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative w-64 max-w-full">
          <Search className="icon-sm text-text-secondary pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={localize('com_ui_tars_mcp_logs_search')}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label={localize('com_ui_refresh')}
        >
          <RefreshCw className="icon-sm" />
        </Button>
      </div>

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}
      {!isLoading && logs.length === 0 && (
        <p className="text-text-secondary py-12 text-center text-sm">
          {localize('com_ui_tars_mcp_logs_empty')}
        </p>
      )}
      {!isLoading && logs.length > 0 && filteredLogs.length === 0 && (
        <p className="text-text-secondary py-12 text-center text-sm">
          {localize('com_ui_no_results_found')}
        </p>
      )}
      {!isLoading && filteredLogs.length > 0 && (
        <>
          <div className="border-border-light overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[64rem] table-fixed text-sm">
              <thead className="bg-surface-secondary text-text-secondary text-left">
                <tr>
                  <th className="w-[28%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_mcp_logs_tool')}
                  </th>
                  <th className="w-[14%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_mcp_logs_server')}
                  </th>
                  <th className="w-[14%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_mcp_logs_user')}
                  </th>
                  <th className="w-[10%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_mcp_logs_status')}
                  </th>
                  <th className="w-[10%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_mcp_logs_duration')}
                  </th>
                  <th className="w-[24%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_mcp_logs_time')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageLogs.map((log) => (
                  <tr key={log.id} className="border-border-light hover:bg-surface-hover border-t">
                    <td className="px-3 py-2">
                      <span className="text-text-primary block font-mono text-xs break-words">
                        {log.tool_name}
                      </span>
                      {log.error_message != null && log.error_message !== '' && (
                        <span className="block text-xs break-words whitespace-normal text-red-500">
                          {log.error_message}
                        </span>
                      )}
                    </td>
                    <td className="text-text-secondary truncate px-3 py-2">
                      {serverNames.get(log.mcp_server_id) ?? log.mcp_server_id}
                    </td>
                    <td className="text-text-secondary truncate px-3 py-2" title={log.sys_user_id}>
                      {log.sys_user_id}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                          log.status === 'success'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="text-text-secondary px-3 py-2">
                      {log.duration_ms != null ? `${log.duration_ms} ms` : '—'}
                    </td>
                    <td className="text-text-secondary truncate px-3 py-2 text-xs">
                      {log.created_at != null ? new Date(log.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <McpPaginationControls
            labelId="tars-mcp-logs-page-size-label"
            page={currentPage}
            pageCount={pageCount}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}
    </div>
  );
}
