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
    <ul className="divide-y divide-border-light">
      {tools.map((tool) => (
        <li key={tool.id} className="flex items-center justify-between gap-3 px-2 py-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs text-text-primary">{tool.name}</p>
            {tool.description != null && tool.description !== '' && (
              <p className="truncate text-xs text-text-secondary" title={tool.description}>
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
          />
        </li>
      ))}
    </ul>
  );
}
