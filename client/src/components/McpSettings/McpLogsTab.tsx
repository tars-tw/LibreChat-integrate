import { useMemo, useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { Input, Button, Spinner, Dropdown } from '@librechat/client';
import { useTarsMcpServersQuery, useTarsMcpLogsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

const LOGS_LIMIT = 100;
const PAGE_SIZES = [10, 25, 50, 100];
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String);

/** Read-only view over pwc_tars `mcp_logs` (newest first, client-side keyword search). */
export default function McpLogsTab() {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
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

  const pageCount = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageLogs = useMemo(
    () => filteredLogs.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [filteredLogs, currentPage, pageSize],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative w-64 max-w-full">
          <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
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
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_mcp_logs_empty')}
        </p>
      )}
      {!isLoading && logs.length > 0 && filteredLogs.length === 0 && (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_no_results_found')}
        </p>
      )}
      {!isLoading && filteredLogs.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border-light">
            <table className="w-full min-w-[64rem] table-fixed text-sm">
              <thead className="bg-surface-secondary text-left text-text-secondary">
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
                  <tr key={log.id} className="border-t border-border-light hover:bg-surface-hover">
                    <td className="px-3 py-2">
                      <span className="block break-words font-mono text-xs text-text-primary">
                        {log.tool_name}
                      </span>
                      {log.error_message != null && log.error_message !== '' && (
                        <span className="block whitespace-normal break-words text-xs text-red-500">
                          {log.error_message}
                        </span>
                      )}
                    </td>
                    <td className="truncate px-3 py-2 text-text-secondary">
                      {serverNames.get(log.mcp_server_id) ?? log.mcp_server_id}
                    </td>
                    <td className="truncate px-3 py-2 text-text-secondary" title={log.sys_user_id}>
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
                    <td className="px-3 py-2 text-text-secondary">
                      {log.duration_ms != null ? `${log.duration_ms} ms` : '—'}
                    </td>
                    <td className="truncate px-3 py-2 text-xs text-text-secondary">
                      {log.created_at != null ? new Date(log.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
            <div className="flex items-center gap-2">
              <span id="tars-mcp-logs-page-size-label">
                {localize('com_ui_tars_mcp_rows_per_page')}
              </span>
              <Dropdown
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(0);
                }}
                options={PAGE_SIZE_OPTIONS}
                aria-labelledby="tars-mcp-logs-page-size-label"
                sizeClasses="min-w-[5rem]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span>
                {localize('com_ui_tars_mcp_page_of', {
                  current: currentPage + 1,
                  total: pageCount,
                })}
              </span>
              <Button
                variant="outline"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {localize('com_ui_tars_mcp_prev_page')}
              </Button>
              <Button
                variant="outline"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                {localize('com_ui_tars_mcp_next_page')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
