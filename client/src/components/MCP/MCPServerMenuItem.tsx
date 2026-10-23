import { useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { MCPIcon, chipVariants } from '@librechat/client';
import { Check, ChevronDown, ChevronRight, KeyRound } from 'lucide-react';
import type { TTarsMcpDomainTool } from 'librechat-data-provider';
import type { TarsMcpCredentialsStatus } from '~/hooks/MCP/useTarsMcpTools';
import type { MCPServerDefinition } from '~/hooks/MCP/useMCPServerManager';
import type { MCPServerStatusIconProps } from './MCPServerStatusIcon';
import {
  getStatusColor,
  getStatusTextKey,
  shouldShowActionButton,
  type ConnectionStatusMap,
} from './mcpServerUtils';
import MCPServerStatusIcon from './MCPServerStatusIcon';
import CustomIcon from '~/components/ui/CustomIcon';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MCPServerMenuItemProps {
  server: MCPServerDefinition;
  isSelected: boolean;
  connectionStatus?: ConnectionStatusMap;
  isInitializing?: (serverName: string) => boolean;
  statusIconProps?: MCPServerStatusIconProps | null;
  onToggle: (serverName: string) => void;
  /** The active brain's usable tools (pwc_tars gateway servers only) — renders a per-tool checklist. */
  toolList?: TTarsMcpDomainTool[];
  /** Checked tool keys; `null`/undefined = every tool checked. */
  selectedToolKeys?: Set<string> | null;
  onToggleTool?: (serverName: string, toolKey: string) => void;
  /** Set for pwc_tars servers needing the user's own credentials — renders the key badge. */
  credentialsStatus?: TarsMcpCredentialsStatus;
  onCredentialsClick?: (serverName: string) => void;
}

function MCPServerToolList({
  serverName,
  toolList,
  selectedToolKeys,
  onToggleTool,
}: {
  serverName: string;
  toolList: TTarsMcpDomainTool[];
  selectedToolKeys?: Set<string> | null;
  onToggleTool?: (serverName: string, toolKey: string) => void;
}) {
  const localize = useLocalize();
  const [isExpanded, setIsExpanded] = useState(true);
  const selectedCount = selectedToolKeys == null ? toolList.length : selectedToolKeys.size;

  return (
    <div className="border-border-light ml-6 border-l pl-2">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-label={localize('com_ui_tars_mcp_toggle_tools')}
        className="text-text-secondary hover:bg-surface-hover hover:text-text-primary flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-xs"
      >
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>
          {localize('com_ui_tars_mcp_tools_count', {
            selected: selectedCount,
            total: toolList.length,
          })}
        </span>
      </button>
      {isExpanded && (
        <div className="flex flex-col">
          {toolList.map((tool) => {
            const isChecked = selectedToolKeys == null || selectedToolKeys.has(tool.tool_key);
            return (
              <button
                key={tool.tool_key}
                type="button"
                role="checkbox"
                aria-checked={isChecked}
                aria-label={tool.name}
                title={tool.description ?? undefined}
                onClick={() => onToggleTool?.(serverName, tool.tool_key)}
                className="hover:bg-surface-hover flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-sm border',
                    isChecked
                      ? 'border-border-xheavy bg-surface-inverted text-text-inverted'
                      : 'border-border-xheavy bg-transparent',
                  )}
                >
                  {isChecked && <Check className="h-3 w-3" />}
                </span>
                <span className="text-text-primary min-w-0 flex-1 truncate font-mono text-xs">
                  {tool.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MCPServerMenuItem({
  server,
  isSelected,
  connectionStatus,
  isInitializing,
  statusIconProps,
  onToggle,
  toolList,
  selectedToolKeys,
  onToggleTool,
  credentialsStatus,
  onCredentialsClick,
}: MCPServerMenuItemProps) {
  const localize = useLocalize();
  const displayName = server.config?.title || server.serverName;
  const statusColor = getStatusColor(server.serverName, connectionStatus, isInitializing);
  const statusTextKey = getStatusTextKey(server.serverName, connectionStatus, isInitializing);
  const statusText = localize(statusTextKey as Parameters<typeof localize>[0]);
  const showActionButton = shouldShowActionButton(statusIconProps);
  const credentialsLabel =
    credentialsStatus === 'needed'
      ? localize('com_ui_tars_mcp_creds_needed')
      : localize('com_ui_tars_mcp_creds_set');

  // Include status in aria-label so screen readers announce it
  const accessibleLabel = `${displayName}, ${statusText}`;

  return (
    <div>
      <Ariakit.MenuItemCheckbox
        hideOnClick={false}
        name="mcp-servers"
        value={server.serverName}
        checked={isSelected}
        onChange={() => onToggle(server.serverName)}
        aria-label={accessibleLabel}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2',
          'transition-all duration-150 outline-none',
          'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
          isSelected && 'bg-surface-active-alt',
        )}
      >
        {/* Server Icon with Status Dot */}
        <div className="text-text-primary relative shrink-0">
          {server.config?.iconPath ? (
            <CustomIcon
              src={server.config.iconPath}
              className="h-8 w-8 rounded-lg object-cover"
              alt=""
            />
          ) : (
            <div className="bg-surface-tertiary text-text-secondary flex h-8 w-8 items-center justify-center rounded-lg">
              <MCPIcon className="h-5 w-5" />
            </div>
          )}
          {/* Status dot - decorative, status is announced via aria-label on MenuItem */}
          <div
            aria-hidden="true"
            className={cn(
              'border-surface-secondary absolute -inset-e-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2',
              statusColor,
            )}
          />
        </div>

        {/* Server Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-text-primary truncate text-sm font-medium">{displayName}</span>
          </div>
          {server.config?.description && (
            <p className="text-text-secondary truncate text-xs">{server.config.description}</p>
          )}
        </div>

        {/* Per-user pwc_tars credentials - amber until the server is authenticated */}
        {credentialsStatus != null && onCredentialsClick != null && (
          <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => onCredentialsClick(server.serverName)}
              aria-label={`${displayName}, ${credentialsLabel}`}
              title={credentialsLabel}
              className={cn(
                chipVariants({ tone: credentialsStatus === 'needed' ? 'warning' : 'success' }),
                'px-1.5 hover:opacity-80',
              )}
            >
              <KeyRound className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Action Button - only show when actionable */}
        {showActionButton && statusIconProps && (
          <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <MCPServerStatusIcon {...statusIconProps} />
          </div>
        )}

        {/* Selection Indicator - purely visual, state conveyed by aria-checked on MenuItem */}
        <span
          aria-hidden="true"
          className={cn(
            'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border',
            isSelected
              ? 'border-border-xheavy bg-surface-inverted text-text-inverted'
              : 'border-border-xheavy bg-transparent',
          )}
        >
          {isSelected && <Check className="h-4 w-4" />}
        </span>
      </Ariakit.MenuItemCheckbox>
      {isSelected && toolList != null && toolList.length > 0 && (
        <MCPServerToolList
          serverName={server.serverName}
          toolList={toolList}
          selectedToolKeys={selectedToolKeys}
          onToggleTool={onToggleTool}
        />
      )}
    </div>
  );
}
