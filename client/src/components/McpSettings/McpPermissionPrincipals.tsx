import { useMemo, useState } from 'react';
import { Chip, Spinner } from '@librechat/client';
import { User, Users, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { TTarsMcpPrincipalInfo, TTarsMcpPermissionPrincipal } from 'librechat-data-provider';
import McpPaginationControls from './McpPaginationControls';
import { useClientPagination } from './useClientPagination';
import { mcpActionClass } from './actions';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Matches `principalKey` from the share dialog, so dialog targets and these rows share one identity. */
export const permissionPrincipalKey = (
  principal: Pick<TTarsMcpPrincipalInfo, 'principal_type' | 'principal_id'>,
): string => `${principal.principal_type}-${principal.principal_id}`;

type SortField = 'name' | 'type' | 'servers' | 'status';

const byName = (a: TTarsMcpPermissionPrincipal, b: TTarsMcpPermissionPrincipal) =>
  a.name.localeCompare(b.name);

/** Ascending order per column; ties fall back to the name so a sort is stable to read. */
const COMPARE: Record<
  SortField,
  (a: TTarsMcpPermissionPrincipal, b: TTarsMcpPermissionPrincipal) => number
> = {
  name: byName,
  type: (a, b) => a.principal_type.localeCompare(b.principal_type) || byName(a, b),
  servers: (a, b) => a.server_count - b.server_count || byName(a, b),
  status: (a, b) => Number(b.is_active) - Number(a.is_active) || byName(a, b),
};

/** Only the icon tells users and groups apart (blue / purple); the label stays in the body color. */
export const TYPE_ICON_COLOR = { user: 'text-series-2', group: 'text-series-5' } as const;

interface McpPermissionPrincipalsProps {
  principals: TTarsMcpPermissionPrincipal[];
  isLoading: boolean;
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
  onEdit,
  onRemove,
}: McpPermissionPrincipalsProps) {
  const localize = useLocalize();
  /** `null` keeps pwc_tars's order (groups first, each by name) until a header is clicked. */
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = useMemo(() => {
    if (sortField == null) {
      return principals;
    }
    const compare = COMPARE[sortField];
    return [...principals].sort((a, b) => (sortAsc ? compare(a, b) : compare(b, a)));
  }, [principals, sortField, sortAsc]);

  const { page, setPage, pageSize, setPageSize, pageCount, pageItems } =
    useClientPagination(sorted);

  const toggleSort = (field: SortField) => {
    if (field === sortField) {
      setSortAsc((prev) => !prev);
      return;
    }
    setSortField(field);
    setSortAsc(true);
  };

  const sortableHeader = (field: SortField, label: string, className: string) => {
    const isSorted = field === sortField;
    let ariaSort: 'ascending' | 'descending' | 'none' = 'none';
    if (isSorted) {
      ariaSort = sortAsc ? 'ascending' : 'descending';
    }
    return (
      <th className={cn('px-3 py-2 font-medium', className)} aria-sort={ariaSort}>
        <button
          type="button"
          onClick={() => toggleSort(field)}
          className="hover:text-text-primary flex items-center gap-1"
        >
          {label}
          {isSorted &&
            (sortAsc ? (
              <ChevronUp className="icon-xs" aria-hidden="true" />
            ) : (
              <ChevronDown className="icon-xs" aria-hidden="true" />
            ))}
        </button>
      </th>
    );
  };

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
                {sortableHeader('name', localize('com_ui_name'), '')}
                {sortableHeader('type', localize('com_ui_tars_mcp_type'), 'w-28')}
                {sortableHeader('servers', localize('com_ui_tars_mcp_server_count'), 'w-24')}
                {sortableHeader('status', localize('com_ui_tars_mcp_status'), 'w-28')}
                <th className="w-24 px-3 py-2 text-right font-medium">
                  {localize('com_ui_actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((principal) => {
                const key = permissionPrincipalKey(principal);
                const isGroup = principal.principal_type === 'group';
                const TypeIcon = isGroup ? Users : User;
                return (
                  <tr key={key} className="border-border-light hover:bg-surface-hover border-t">
                    <td className="px-3 py-2">
                      <span className="text-text-primary block truncate font-medium">
                        {principal.name}
                      </span>
                      {principal.email != null && principal.email !== '' && (
                        <span className="text-text-secondary block truncate text-xs">
                          {principal.email}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-text-primary inline-flex items-center gap-1.5">
                        <TypeIcon
                          className={cn('icon-sm', TYPE_ICON_COLOR[principal.principal_type])}
                          aria-hidden="true"
                        />
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
                            className={mcpActionClass('neutral')}
                          >
                            <Pencil className="icon-sm" />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`${localize('com_ui_tars_mcp_permission_remove')} ${principal.name}`}
                          title={localize('com_ui_tars_mcp_permission_remove')}
                          onClick={() => onRemove(principal)}
                          className={mcpActionClass('danger')}
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
      {!isLoading && principals.length > 0 && (
        <McpPaginationControls
          labelId="tars-mcp-assigned-page-size-label"
          page={page}
          pageCount={pageCount}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </section>
  );
}
