import { Spinner, Checkbox } from '@librechat/client';
import type { TTarsMcpTool } from 'librechat-data-provider';
import type { ToolScope, CheckState } from './grants';
import { grantedToolIds, isToolGranted } from './grants';
import { useLocalize } from '~/hooks';

interface McpToolChecklistProps {
  tools: TTarsMcpTool[];
  isLoading: boolean;
  scope: ToolScope;
  onToggle: (toolId: string, checked: boolean) => void;
  /** The last granted tool cannot be unchecked — the grant is removed as a whole instead. */
  keepOne?: boolean;
  /** Each tool's state when it is not read off `scope` alone, e.g. across several targets. */
  stateOf?: (toolId: string) => CheckState;
}

/** One server's tools with a checkbox each, as both permission editors show them. */
export default function McpToolChecklist({
  tools,
  isLoading,
  scope,
  onToggle,
  keepOne = false,
  stateOf,
}: McpToolChecklistProps) {
  const localize = useLocalize();
  const granted = grantedToolIds(
    scope,
    tools.map((tool) => tool.id),
  );
  const isLastGranted = (toolId: string) => keepOne && granted.size === 1 && granted.has(toolId);

  return (
    <ul className="bg-surface-secondary space-y-1 px-4 py-2 sm:px-6">
      {isLoading && (
        <li>
          <Spinner className="icon-sm" />
        </li>
      )}
      {!isLoading &&
        tools.map((tool) => {
          const checkState = stateOf ? stateOf(tool.id) : isToolGranted(scope, tool.id);
          const isChecked = checkState !== false;
          const isLocked = isLastGranted(tool.id);
          return (
            <li key={tool.id}>
              <div
                className="hover:bg-surface-hover flex items-start gap-2 rounded-lg px-2 py-2"
                title={isLocked ? localize('com_ui_tars_mcp_keep_one_tool') : undefined}
              >
                <Checkbox
                  aria-label={tool.name}
                  checked={checkState}
                  disabled={isLocked}
                  onCheckedChange={(checked) => onToggle(tool.id, checked === true)}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs ${
                      isChecked
                        ? 'bg-accent-primary/15 text-accent-primary'
                        : 'bg-surface-tertiary text-text-primary'
                    }`}
                  >
                    {tool.name}
                  </span>
                  {tool.description != null && tool.description !== '' && (
                    <p className="text-text-secondary mt-1 text-xs break-words whitespace-normal">
                      {tool.description}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      {!isLoading && tools.length === 0 && (
        <li className="text-text-secondary text-xs">{localize('com_ui_tars_mcp_no_tools')}</li>
      )}
    </ul>
  );
}
