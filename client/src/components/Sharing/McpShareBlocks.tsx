import { Alert } from '@librechat/client';
import type { TTarsMcpShareGap, TTarsMcpShareBlock } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

/** A long tool list would push the dialog's own controls off screen. */
const MAX_LISTED_TOOLS = 3;

function useGapLabel() {
  const localize = useLocalize();
  return ({ server_name: server, no_access, tool_names }: TTarsMcpShareGap): string => {
    if (no_access) {
      return localize('com_ui_tars_mcp_share_gap_server', { server });
    }
    const listed = tool_names.slice(0, MAX_LISTED_TOOLS).join(', ');
    return localize('com_ui_tars_mcp_share_gap_tools', {
      server,
      tools:
        tool_names.length > MAX_LISTED_TOOLS
          ? localize('com_ui_tars_mcp_share_gap_more', { tools: listed, count: tool_names.length })
          : listed,
    });
  };
}

/** Who a share was refused for, and which MCP servers or tools each of them lacks. */
export default function McpShareBlocks({ blocks }: { blocks: TTarsMcpShareBlock[] }) {
  const localize = useLocalize();
  const gapLabel = useGapLabel();

  return (
    <Alert variant="error">
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{localize('com_ui_tars_mcp_share_blocked')}</p>
        <ul className="list-disc space-y-0.5 ps-4">
          {blocks.map((block) => (
            <li key={`${block.principal_type}-${block.idOnTheSource}`} className="break-words">
              <span className="font-medium">{block.name}</span>
              {': '}
              {block.servers.map(gapLabel).join(', ')}
            </li>
          ))}
        </ul>
      </div>
    </Alert>
  );
}
