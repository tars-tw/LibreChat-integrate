import { Plus } from 'lucide-react';
import { MCPIcon, Spinner } from '@librechat/client';
import type { TTarsMcpDomainServer } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MCPPendingServerItemProps {
  server: TTarsMcpDomainServer;
  isEnabling: boolean;
  onEnable: (serverId: string) => void;
}

/**
 * A server the active brain grants but the user has not opted into. Shown muted
 * with a one-click opt-in so a brain's allowance never silently disappears from
 * chat — pwc_tars defaults every server to off, which otherwise reads as the
 * permission not having been granted at all.
 */
export default function MCPPendingServerItem({
  server,
  isEnabling,
  onEnable,
}: MCPPendingServerItemProps) {
  const localize = useLocalize();
  const toolCount = server.tool_count ?? 0;

  return (
    <button
      type="button"
      disabled={isEnabling}
      onClick={() => onEnable(server.id)}
      aria-label={`${server.name}, ${localize('com_ui_tars_mcp_enable_server')}`}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left',
        'opacity-60 transition-all duration-150 hover:bg-surface-hover hover:opacity-100',
        isEnabling && 'cursor-wait',
      )}
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-tertiary">
        <MCPIcon className="h-5 w-5 text-text-secondary" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">{server.name}</span>
        <span className="block truncate text-xs text-text-secondary">
          {toolCount > 0
            ? localize('com_ui_tars_mcp_enable_hint_count', { count: toolCount })
            : localize('com_ui_tars_mcp_enable_hint')}
        </span>
      </div>
      <span className="flex-shrink-0 text-text-secondary group-hover:text-text-primary">
        {isEnabling ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </span>
    </button>
  );
}
