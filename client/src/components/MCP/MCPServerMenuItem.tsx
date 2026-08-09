import { useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { MCPIcon } from '@librechat/client';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { TTarsMcpDomainTool } from 'librechat-data-provider';
import type { MCPServerDefinition } from '~/hooks/MCP/useMCPServerManager';
import type { MCPServerStatusIconProps } from './MCPServerStatusIcon';
import {
  getStatusColor,
  getStatusTextKey,
  shouldShowActionButton,
  type ConnectionStatusMap,
} from './mcpServerUtils';
import MCPServerStatusIcon from './MCPServerStatusIcon';
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
    <div className="ml-6 border-l border-border-light pl-2">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-label={localize('com_ui_tars_mcp_toggle_tools')}
        className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
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
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-hover"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-sm border',
                    isChecked
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border-xheavy bg-transparent',
                  )}
                >
                  {isChecked && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
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
}: MCPServerMenuItemProps) {
  const localize = useLocalize();
  const displayName = server.config?.title || server.serverName;
  const statusColor = getStatusColor(server.serverName, connectionStatus, isInitializing);
  const statusTextKey = getStatusTextKey(server.serverName, connectionStatus, isInitializing);
  const statusText = localize(statusTextKey as Parameters<typeof localize>[0]);
  const showActionButton = shouldShowActionButton(statusIconProps);

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
          'outline-none transition-all duration-150',
          'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
          isSelected && 'bg-surface-active-alt',
        )}
      >
        {/* Server Icon with Status Dot */}
        <div className="relative flex-shrink-0">
          {server.config?.iconPath ? (
            <img
              src={server.config.iconPath}
              className="h-8 w-8 rounded-lg object-cover"
              alt={displayName}
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary">
              <MCPIcon className="h-5 w-5 text-text-secondary" />
            </div>
          )}
          {/* Status dot - decorative, status is announced via aria-label on MenuItem */}
          <div
            aria-hidden="true"
            className={cn(
              'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-secondary',
              statusColor,
            )}
          />
        </div>

        {/* Server Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-text-primary">{displayName}</span>
          </div>
          {server.config?.description && (
            <p className="truncate text-xs text-text-secondary">{server.config.description}</p>
          )}
        </div>

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
              ? 'border-primary bg-primary text-primary-foreground'
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
