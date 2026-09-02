import { Switch, Spinner, useToastContext } from '@librechat/client';
import type { TTarsMcpTool } from 'librechat-data-provider';
import { useTarsMcpServerQuery, useUpdateTarsMcpToolMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * Expandable per-server tool list for the admin table: every `mcp_tools` row
 * with an enable/disable switch (`PUT /api/tars/mcp/admin/tools/:toolId`).
 */
export default function McpServerToolsPanel({ serverId }: { serverId: string }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: server, isLoading } = useTarsMcpServerQuery(serverId);
  const updateTool = useUpdateTarsMcpToolMutation({
    onError: (error) =>
      showToast({ message: (error as Error)?.message ?? 'Error', status: 'error' }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner className="icon-sm" />
      </div>
    );
  }

  const tools: TTarsMcpTool[] = server?.tools ?? [];
  if (tools.length === 0) {
    return (
      <p className="py-3 text-center text-xs text-text-secondary">
        {localize('com_ui_tars_mcp_no_tools')}
      </p>
    );
  }

  return (
    <div>
      <p className="mb-2 px-2 text-xs font-medium text-text-secondary">
        {localize('com_ui_tars_mcp_server_tool_count', { count: tools.length })}
      </p>
      <ul className="divide-y divide-border-light">
        {tools.map((tool) => (
          <li key={tool.id} className="flex items-start justify-between gap-3 px-2 py-2">
            <div className="min-w-0 flex-1">
              <span className="inline-block rounded bg-surface-tertiary px-1.5 py-0.5 font-mono text-xs text-text-primary">
                {tool.name}
              </span>
              {tool.description != null && tool.description !== '' && (
                <p className="mt-1 whitespace-normal break-words text-xs text-text-secondary">
                  {tool.description}
                </p>
              )}
            </div>
            <Switch
              aria-label={localize('com_ui_tars_mcp_tool_enabled', { name: tool.name })}
              checked={tool.is_enabled !== false}
              disabled={updateTool.isLoading}
              onCheckedChange={(checked) =>
                updateTool.mutate({ id: tool.id, data: { is_enabled: checked } })
              }
              className="mt-0.5 shrink-0"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
