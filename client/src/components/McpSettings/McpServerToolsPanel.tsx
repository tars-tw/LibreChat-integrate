import { Spinner, useToastContext } from '@librechat/client';
import type { TTarsMcpTool } from 'librechat-data-provider';
import { useTarsMcpServerQuery, useUpdateTarsMcpToolMutation } from '~/data-provider';
import McpDirectToolsPanel from './McpDirectToolsPanel';
import McpToolRow from './McpToolRow';
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

  /** pwc_tars holds no tool rows for an OIDC server, so its switches live elsewhere. */
  const auth = server?.connection_config?.auth as { type?: string } | undefined;
  if (auth?.type === 'oidc') {
    return <McpDirectToolsPanel serverId={serverId} />;
  }

  const tools: TTarsMcpTool[] = server?.tools ?? [];
  if (tools.length === 0) {
    return (
      <p className="text-text-secondary py-3 text-center text-xs">
        {localize('com_ui_tars_mcp_no_tools')}
      </p>
    );
  }

  return (
    <div>
      <p className="text-text-secondary mb-2 px-2 text-xs font-medium">
        {localize('com_ui_tars_mcp_server_tool_count', { count: tools.length })}
      </p>
      <ul className="divide-border-light divide-y">
        {tools.map((tool) => (
          <McpToolRow
            key={tool.id}
            name={tool.name}
            description={tool.description}
            enabled={tool.is_enabled !== false}
            disabled={updateTool.isLoading}
            onChange={(checked) =>
              updateTool.mutate({ id: tool.id, data: { is_enabled: checked } })
            }
          />
        ))}
      </ul>
    </div>
  );
}
