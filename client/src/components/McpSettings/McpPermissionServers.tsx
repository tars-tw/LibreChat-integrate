import { useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Spinner, FilterInput } from '@librechat/client';
import type {
  TTarsMcpServer,
  TTarsMcpPrincipalType,
  TTarsMcpPermissionPrincipal,
} from 'librechat-data-provider';
import type { ReactNode } from 'react';
import McpPaginationControls from './McpPaginationControls';
import { useClientPagination } from './useClientPagination';
import AssigneesCell from '~/components/Tars/Assignees';
import { filterManagedServers } from './servers';
import ServerTypeBadge from './ServerTypeBadge';
import { mcpActionClass } from './actions';
import { useLocalize } from '~/hooks';

type ServerAssignees = Record<TTarsMcpPrincipalType, TTarsMcpPermissionPrincipal[]>;

const NO_ASSIGNEES: ServerAssignees = { user: [], group: [] };

/** Inverts each principal's `mcp_server_ids` into the users and groups granted each server. */
const assigneesByServer = (principals: TTarsMcpPermissionPrincipal[]) => {
  const byServer = new Map<string, ServerAssignees>();
  for (const principal of principals) {
    for (const serverId of principal.mcp_server_ids) {
      const entry = byServer.get(serverId) ?? { user: [], group: [] };
      entry[principal.principal_type].push(principal);
      byServer.set(serverId, entry);
    }
  }
  return byServer;
};

interface McpPermissionServersProps {
  servers: TTarsMcpServer[];
  principals: TTarsMcpPermissionPrincipal[];
  principalsLoading: boolean;
  /** Buttons shown after the search field. */
  actions?: ReactNode;
  /** Opens the server-centric assignment of one server. */
  onAssign: (server: TTarsMcpServer) => void;
}

/**
 * Who each managed server is assigned to: the users and groups granted it directly
 * (group members are not expanded), counted from the principals overview.
 */
export default function McpPermissionServers({
  servers,
  principals,
  principalsLoading,
  actions,
  onAssign,
}: McpPermissionServersProps) {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const rows = useMemo(() => filterManagedServers(servers, search), [servers, search]);
  const assignees = useMemo(() => assigneesByServer(principals), [principals]);
  const { page, setPage, pageSize, setPageSize, pageCount, pageItems } = useClientPagination(rows);

  const renderAssignees = (server: TTarsMcpServer, type: TTarsMcpPrincipalType) => {
    if (principalsLoading) {
      return <Spinner className="icon-sm" />;
    }
    const list = (assignees.get(server.id) ?? NO_ASSIGNEES)[type];
    return (
      <AssigneesCell
        type={type}
        assignees={list}
        title={localize(
          type === 'group'
            ? 'com_ui_tars_mcp_server_groups_title'
            : 'com_ui_tars_mcp_server_users_title',
          { name: server.name, count: list.length },
        )}
      />
    );
  };

  return (
    <section className="space-y-3" aria-labelledby="tars-mcp-servers-overview-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="tars-mcp-servers-overview-title"
            className="text-text-primary text-sm font-medium"
          >
            {localize('com_ui_tars_mcp_servers_overview')}
          </h2>
          <p className="text-text-secondary mt-1 text-xs">
            {localize('com_ui_tars_mcp_servers_overview_hint')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterInput
            inputId="tars-mcp-servers-overview-search"
            label={localize('com_ui_tars_mcp_search')}
            surface="presentation"
            containerClassName="w-64 max-w-full"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          {actions}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="border-border-medium text-text-secondary rounded-lg border border-dashed py-6 text-center text-sm">
          {localize('com_ui_tars_mcp_empty')}
        </p>
      ) : (
        <>
          <div className="border-border-light overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-surface-secondary text-text-secondary text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{localize('com_ui_name')}</th>
                  <th className="w-32 px-3 py-2 font-medium">{localize('com_ui_tars_mcp_type')}</th>
                  <th className="w-24 px-3 py-2 font-medium">{localize('com_ui_user')}</th>
                  <th className="w-24 px-3 py-2 font-medium">{localize('com_ui_group')}</th>
                  <th className="w-20 px-3 py-2 text-right font-medium">
                    {localize('com_ui_actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((server) => (
                  <tr
                    key={server.id}
                    className="border-border-light hover:bg-surface-hover border-t"
                  >
                    <td className="px-3 py-2">
                      <span
                        className="text-text-primary block truncate font-medium"
                        title={server.name}
                      >
                        {server.name}
                      </span>
                      {server.code != null && server.code !== '' && (
                        <span className="text-text-secondary block truncate font-mono text-xs">
                          {server.code}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <ServerTypeBadge type={server.type} />
                    </td>
                    <td className="px-1.5 py-1">{renderAssignees(server, 'user')}</td>
                    <td className="px-1.5 py-1">{renderAssignees(server, 'group')}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => onAssign(server)}
                          aria-label={localize('com_ui_tars_mcp_assign_server_title', {
                            name: server.name,
                          })}
                          title={localize('com_ui_tars_mcp_assign_server')}
                          className={mcpActionClass('neutral')}
                        >
                          <UserPlus className="icon-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <McpPaginationControls
            labelId="tars-mcp-servers-overview-page-size-label"
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}
    </section>
  );
}
