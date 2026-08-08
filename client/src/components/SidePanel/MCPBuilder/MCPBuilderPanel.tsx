import { useState, useRef, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { PermissionTypes, Permissions, isTarsMcpServerName } from 'librechat-data-provider';
import { Button, Spinner, FilterInput, OGDialogTrigger, TooltipAnchor } from '@librechat/client';
import { useLocalize, useMCPServerManager, useHasAccess } from '~/hooks';
import MCPConfigDialog from '~/components/MCP/MCPConfigDialog';
import { useGetStartupConfig } from '~/data-provider';
import MCPAdminSettings from './MCPAdminSettings';
import MCPServerDialog from './MCPServerDialog';
import MCPServerList from './MCPServerList';
import TarsCard from './TarsCard';

export default function MCPBuilderPanel() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const { availableMCPServers, isLoading, getServerStatusIconProps, getConfigDialogProps } =
    useMCPServerManager();

  /**
   * pwc_tars as MCP source of truth: server management lives in TarsCard /
   * `/mcp-settings`, so the native add-by-URL flow and server cards are hidden.
   */
  const tarsMcpEnabled = startupConfig?.tarsMcpEnabled === true;
  const hasCreateAccess =
    useHasAccess({
      permissionType: PermissionTypes.MCP_SERVERS,
      permission: Permissions.CREATE,
    }) && !tarsMcpEnabled;
  const [showDialog, setShowDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const configDialogProps = getConfigDialogProps();

  const filteredServers = useMemo(() => {
    /** The injected TARS gateway servers' cards are replaced by {@link TarsCard}. */
    const servers = availableMCPServers.filter((server) => !isTarsMcpServerName(server.serverName));
    if (!searchQuery.trim()) {
      return servers;
    }
    const query = searchQuery.toLowerCase();
    return servers.filter((server) => {
      const displayName = server.config?.title || server.serverName;
      return (
        displayName.toLowerCase().includes(query) || server.serverName.toLowerCase().includes(query)
      );
    });
  }, [availableMCPServers, searchQuery]);

  return (
    <div className="flex h-auto w-full flex-col px-3 pb-3 pt-2">
      <div role="region" aria-label={localize('com_ui_mcp_servers')} className="space-y-2">
        {/* Toolbar: Search + Add Button — the list it controls is hidden when pwc_tars manages MCP servers */}
        {!tarsMcpEnabled && (
          <div className="flex items-center gap-2">
            <FilterInput
              inputId="mcp-filter"
              label={localize('com_ui_filter_mcp_servers')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              containerClassName="flex-1"
            />
            {hasCreateAccess && (
              <MCPServerDialog
                open={showDialog}
                onOpenChange={setShowDialog}
                triggerRef={addButtonRef}
              >
                <OGDialogTrigger asChild>
                  <TooltipAnchor
                    description={localize('com_ui_add_mcp')}
                    side="bottom"
                    render={
                      <Button
                        ref={addButtonRef}
                        variant="outline"
                        size="icon"
                        className="size-9 shrink-0 bg-transparent"
                        onClick={() => setShowDialog(true)}
                        aria-label={localize('com_ui_add_mcp')}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                      </Button>
                    }
                  />
                </OGDialogTrigger>
              </MCPServerDialog>
            )}
          </div>
        )}

        {/* pwc_tars tool source (catalog / toggles / credentials; admin: manage) */}
        <TarsCard />

        {/* Server Cards List — hidden when pwc_tars manages MCP servers */}
        {!tarsMcpEnabled &&
          (isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Spinner className="size-6" aria-label={localize('com_ui_loading')} />
            </div>
          ) : (
            <MCPServerList
              servers={filteredServers}
              getServerStatusIconProps={getServerStatusIconProps}
              isFiltered={searchQuery.trim().length > 0}
            />
          ))}

        {/* Config Dialog for custom user vars */}
        {configDialogProps && <MCPConfigDialog {...configDialogProps} />}

        {/* Admin Settings Section */}
        <MCPAdminSettings />
      </div>
    </div>
  );
}
