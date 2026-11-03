import { Alert } from '@librechat/client';
import type { TTarsMcpShareBlock } from 'librechat-data-provider';
import { shareGapLabel } from './gaps';
import { useLocalize } from '~/hooks';

/** Who a share was refused for, and which 專用腦, MCP servers or tools each of them lacks. */
export default function McpShareBlocks({ blocks }: { blocks: TTarsMcpShareBlock[] }) {
  const localize = useLocalize();

  return (
    <Alert variant="error">
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{localize('com_ui_tars_mcp_share_blocked')}</p>
        <ul className="list-disc space-y-0.5 ps-4">
          {blocks.map((block) => (
            <li key={`${block.principal_type}-${block.idOnTheSource}`} className="break-words">
              <span className="font-medium">{block.name}</span>
              {': '}
              {shareGapLabel(block, localize)}
            </li>
          ))}
        </ul>
      </div>
    </Alert>
  );
}
