import { useMemo } from 'react';
import { Dropdown } from '@librechat/client';
import type { TTarsWorkflowActAs } from 'librechat-data-provider';
import { useTarsWorkflowAccountsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** `self`, `system`, or `user:<tarsId>` — a Dropdown value naming a workspace. */
export type Workspace = string;

export const OWN_WORKSPACE: Workspace = 'self';
const SYSTEM_WORKSPACE: Workspace = 'system';
const USER_PREFIX = 'user:';

/** The `actAs` a workspace choice asks the ticket for; none for the admin's own workspace. */
export function actAsOf(workspace: Workspace): TTarsWorkflowActAs | undefined {
  if (workspace === SYSTEM_WORKSPACE) {
    return { type: 'system' };
  }
  if (workspace.startsWith(USER_PREFIX)) {
    return { type: 'user', tarsId: workspace.slice(USER_PREFIX.length) };
  }
  return undefined;
}

/**
 * Admin-only bar above the Workflow iframe: whose workspace to work in — their own, the shared
 * system account, or that of anyone who has entered Workflow. LibreChat audits each switch.
 */
export default function WorkspaceSwitcher({
  value,
  onChange,
}: {
  value: Workspace;
  onChange: (workspace: Workspace) => void;
}) {
  const localize = useLocalize();
  const { data: accounts = [] } = useTarsWorkflowAccountsQuery();

  const options = useMemo(
    () => [
      { value: OWN_WORKSPACE, label: localize('com_ui_langflow_workspace_self') },
      { value: SYSTEM_WORKSPACE, label: localize('com_ui_langflow_workspace_system') },
      ...(accounts.length > 0 ? [{ divider: true as const }] : []),
      ...accounts.map((account) => ({
        value: `${USER_PREFIX}${account.tarsId}`,
        label: account.username,
      })),
    ],
    [accounts, localize],
  );

  return (
    <div className="border-border-light flex shrink-0 items-center gap-3 border-b px-4 py-2">
      <span id="langflow-workspace-label" className="text-text-primary text-sm">
        {localize('com_ui_langflow_workspace')}
      </span>
      <Dropdown
        value={value}
        onChange={onChange}
        options={options}
        aria-labelledby="langflow-workspace-label"
        sizeClasses="min-w-[12rem]"
        searchable
        searchPlaceholder={localize('com_ui_langflow_workspace_search')}
        searchEmptyText={localize('com_ui_langflow_workspace_empty')}
      />
      <span className="text-text-secondary text-xs">
        {localize('com_ui_langflow_workspace_hint')}
      </span>
    </div>
  );
}
