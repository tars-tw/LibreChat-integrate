import { Chip } from '@librechat/client';
import { User, Users } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import type { TTarsPrincipalInfo, TTarsPrincipalType } from 'librechat-data-provider';
import { TYPE_ICON_COLOR } from '~/components/McpSettings/McpPermissionPrincipals';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface AssigneesCellProps {
  type: TTarsPrincipalType;
  assignees: TTarsPrincipalInfo[];
  /** Heading of the list and the trigger's accessible name, e.g. "Users of X (3)". */
  title: string;
}

/**
 * How many users or groups a permission grants directly (group members are not
 * expanded); the count opens their names, disabled ones marked. Shared by the MCP
 * server overview and the model list.
 */
export default function AssigneesCell({ type, assignees, title }: AssigneesCellProps) {
  const localize = useLocalize();
  const Icon = type === 'group' ? Users : User;

  if (assignees.length === 0) {
    return (
      <span className="text-text-secondary inline-flex items-center gap-1.5 px-1.5 py-1">
        <Icon className="icon-sm" aria-hidden="true" />0
      </span>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={title}
          className="text-text-primary hover:bg-surface-tertiary inline-flex items-center gap-1.5 rounded px-1.5 py-1"
        >
          <Icon className={cn('icon-sm', TYPE_ICON_COLOR[type])} aria-hidden="true" />
          {assignees.length}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="border-border-light bg-surface-primary text-text-primary z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border shadow-lg"
        >
          <p className="border-border-light text-text-secondary border-b px-3 py-2 text-xs font-medium">
            {title}
          </p>
          <ul className="max-h-64 overflow-y-auto py-1">
            {assignees.map((principal) => (
              <li key={principal.principal_id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{principal.name}</span>
                  {principal.email != null && principal.email !== '' && (
                    <span className="text-text-secondary block truncate text-xs">
                      {principal.email}
                    </span>
                  )}
                </span>
                {!principal.is_active && <Chip>{localize('com_ui_tars_mcp_disabled')}</Chip>}
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
