import { Chip, Spinner } from '@librechat/client';
import { Pencil, Trash2, User, Users } from 'lucide-react';
import type { TTarsMcpPermissionPrincipal } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Matches `principalKey` from the share dialog, so the editor's targets and these rows share one identity. */
export const permissionPrincipalKey = (principal: TTarsMcpPermissionPrincipal): string =>
  `${principal.principal_type}-${principal.principal_id}`;

const ACTION_BUTTON =
  'rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary';

interface McpPermissionPrincipalsProps {
  principals: TTarsMcpPermissionPrincipal[];
  isLoading: boolean;
  /** The single principal currently loaded in the editor above. */
  editingKey: string | null;
  onEdit: (principal: TTarsMcpPermissionPrincipal) => void;
  onRemove: (principal: TTarsMcpPermissionPrincipal) => void;
}

/**
 * Everyone holding MCP grants. A disabled user or group keeps its rows (they grant
 * nothing until it is re-enabled) and can only be removed, never edited.
 */
export default function McpPermissionPrincipals({
  principals,
  isLoading,
  editingKey,
  onEdit,
  onRemove,
}: McpPermissionPrincipalsProps) {
  const localize = useLocalize();

  return (
    <section className="space-y-3" aria-labelledby="tars-mcp-assigned-title">
      <div>
        <h2 id="tars-mcp-assigned-title" className="text-text-primary text-sm font-medium">
          {localize('com_ui_tars_mcp_assigned_title')}
        </h2>
        <p className="text-text-secondary mt-1 text-xs">
          {localize('com_ui_tars_mcp_assigned_hint')}
        </p>
      </div>

      {isLoading && (
        <div className="flex h-20 items-center justify-center">
          <Spinner />
        </div>
      )}
      {!isLoading && principals.length === 0 && (
        <p className="border-border-medium text-text-secondary rounded-lg border border-dashed py-6 text-center text-sm">
          {localize('com_ui_tars_mcp_assigned_empty')}
        </p>
      )}
      {!isLoading && principals.length > 0 && (
        <div className="border-border-light overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-secondary text-text-secondary text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{localize('com_ui_name')}</th>
                <th className="w-28 px-3 py-2 font-medium">{localize('com_ui_tars_mcp_type')}</th>
                <th className="w-24 px-3 py-2 font-medium">
                  {localize('com_ui_tars_mcp_server_count')}
                </th>
                <th className="w-28 px-3 py-2 font-medium">{localize('com_ui_tars_mcp_status')}</th>
                <th className="w-24 px-3 py-2 text-right font-medium">
                  {localize('com_ui_actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {principals.map((principal) => {
                const key = permissionPrincipalKey(principal);
                const isGroup = principal.principal_type === 'group';
                const isEditing = key === editingKey;
                const TypeIcon = isGroup ? Users : User;
                return (
                  <tr
                    key={key}
                    className={cn(
                      'border-border-light border-t',
                      isEditing ? 'bg-surface-active-alt' : 'hover:bg-surface-hover',
                    )}
                  >
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-text-primary truncate font-medium">
                          {principal.name}
                        </span>
                        {isEditing && (
                          <Chip tone="info">{localize('com_ui_tars_mcp_principal_editing')}</Chip>
                        )}
                      </div>
                      {principal.email != null && principal.email !== '' && (
                        <span className="text-text-secondary block truncate text-xs">
                          {principal.email}
                        </span>
                      )}
                    </td>
                    <td className="text-text-secondary px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <TypeIcon className="icon-sm" aria-hidden="true" />
                        {localize(isGroup ? 'com_ui_group' : 'com_ui_user')}
                      </span>
                    </td>
                    <td className="text-text-secondary px-3 py-2">{principal.server_count}</td>
                    <td className="px-3 py-2">
                      <Chip tone={principal.is_active ? 'success' : 'neutral'}>
                        {localize(
                          principal.is_active
                            ? 'com_ui_tars_mcp_principal_active'
                            : 'com_ui_tars_mcp_disabled',
                        )}
                      </Chip>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {principal.is_active && (
                          <button
                            type="button"
                            aria-label={`${localize('com_ui_edit')} ${principal.name}`}
                            title={localize('com_ui_edit')}
                            onClick={() => onEdit(principal)}
                            className={ACTION_BUTTON}
                          >
                            <Pencil className="icon-sm" />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`${localize('com_ui_tars_mcp_permission_remove')} ${principal.name}`}
                          title={localize('com_ui_tars_mcp_permission_remove')}
                          onClick={() => onRemove(principal)}
                          className={cn(ACTION_BUTTON, 'hover:text-text-destructive')}
                        >
                          <Trash2 className="icon-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
