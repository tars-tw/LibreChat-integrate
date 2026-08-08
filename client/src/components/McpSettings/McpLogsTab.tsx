import { useMemo, useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { Input, Button, Spinner } from '@librechat/client';
import { useTarsMcpServersQuery, useTarsMcpLogsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

const LOGS_LIMIT = 100;

/** Read-only view over pwc_tars `mcp_logs` (newest first, optional conversation filter). */
export default function McpLogsTab() {
  const localize = useLocalize();
  const [conversationId, setConversationId] = useState('');
  const [appliedConversationId, setAppliedConversationId] = useState('');
  const { data: servers = [] } = useTarsMcpServersQuery();
  const {
    data: logs = [],
    isLoading,
    refetch,
    isFetching,
  } = useTarsMcpLogsQuery({
    conversationId: appliedConversationId || undefined,
    limit: LOGS_LIMIT,
  });

  const serverNames = useMemo(
    () => new Map(servers.map((server) => [server.id, server.name])),
    [servers],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <Input
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setAppliedConversationId(conversationId.trim())}
            placeholder={localize('com_ui_tars_mcp_logs_conversation_filter')}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={() => setAppliedConversationId(conversationId.trim())}>
          {localize('com_ui_tars_mcp_logs_filter')}
        </Button>
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
      {!isLoading && logs.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border-light">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-surface-secondary text-left text-text-secondary">
              <tr>
                <th className="w-[22%] px-4 py-2 font-medium">
                  {localize('com_ui_tars_mcp_logs_tool')}
                </th>
                <th className="w-[18%] px-4 py-2 font-medium">
                  {localize('com_ui_tars_mcp_logs_server')}
                </th>
                <th className="w-[18%] px-4 py-2 font-medium">
                  {localize('com_ui_tars_mcp_logs_user')}
                </th>
                <th className="w-[12%] px-4 py-2 font-medium">
                  {localize('com_ui_tars_mcp_logs_status')}
                </th>
                <th className="w-[10%] px-4 py-2 font-medium">
                  {localize('com_ui_tars_mcp_logs_duration')}
                </th>
                <th className="w-[20%] px-4 py-2 font-medium">
                  {localize('com_ui_tars_mcp_logs_time')}
                </th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-border-light hover:bg-surface-hover">
                  <td className="px-4 py-2">
                    <span
                      className="block truncate font-mono text-xs text-text-primary"
                      title={log.tool_name}
                    >
                      {log.tool_name}
                    </span>
                    {log.error_message != null && log.error_message !== '' && (
                      <span
                        className="block truncate text-xs text-red-500"
                        title={log.error_message}
                      >
                        {log.error_message}
                      </span>
                    )}
                  </td>
                  <td className="truncate px-4 py-2 text-text-secondary">
                    {serverNames.get(log.mcp_server_id) ?? log.mcp_server_id}
                  </td>
                  <td className="truncate px-4 py-2 text-text-secondary" title={log.sys_user_id}>
                    {log.sys_user_id}
                  </td>
                  <td className="px-4 py-2">
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
                  <td className="px-4 py-2 text-text-secondary">
                    {log.duration_ms != null ? `${log.duration_ms} ms` : '—'}
                  </td>
                  <td className="truncate px-4 py-2 text-xs text-text-secondary">
                    {log.created_at != null ? new Date(log.created_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
