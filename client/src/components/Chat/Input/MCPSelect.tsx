import React, { memo, useMemo } from 'react';
import * as Ariakit from '@ariakit/react';
import { ChevronDown } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { PermissionTypes, Permissions, TARS_SQL_MCP_SERVER_NAME } from 'librechat-data-provider';
import MCPPendingServerItem from '~/components/MCP/MCPPendingServerItem';
import MCPServerMenuItem from '~/components/MCP/MCPServerMenuItem';
import MCPConfigDialog from '~/components/MCP/MCPConfigDialog';
import StackedMCPIcons from '~/components/MCP/StackedMCPIcons';
import { useHasAccess, useLocalize } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { cn } from '~/utils';

function MCPSelectContent() {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const {
    conversationId,
    storageContextKey,
    mcpServerManager: manager,
    tarsMcpTools,
  } = context ?? {};

  const menuStore = Ariakit.useMenuStore({ focusLoop: true });
  const isOpen = menuStore.useState('open');

  /** Gateway entries the active brain (domain) may not use are hidden, as is the
   *  SQL agent — it owns a top-level tools-menu row and badge of its own. */
  const visibleServers = useMemo(() => {
    const servers = (manager?.selectableServers ?? []).filter(
      (s) => s.serverName !== TARS_SQL_MCP_SERVER_NAME,
    );
    if (!tarsMcpTools) {
      return servers;
    }
    return servers.filter((s) => tarsMcpTools.isServerAllowed(s.serverName));
  }, [manager?.selectableServers, tarsMcpTools]);

  /** Selections this badge speaks for — the SQL agent's is counted by its own badge. */
  const selectedNames = useMemo(
    () => (manager?.mcpValues ?? []).filter((name) => name !== TARS_SQL_MCP_SERVER_NAME),
    [manager?.mcpValues],
  );

  const selectedServers = useMemo(() => {
    if (selectedNames.length === 0) {
      return [];
    }
    const selectedSet = new Set(selectedNames);
    return visibleServers.filter((s) => selectedSet.has(s.serverName));
  }, [visibleServers, selectedNames]);

  /** Counts what the menu actually offers, never the raw selection: a name the
   *  catalog has not returned — or one the admin has hidden — renders no row,
   *  and billing it to the badge reads as a server that cannot be turned off. */
  const displayText = useMemo(() => {
    const selectedCount = selectedServers.length;
    if (selectedCount === 0) {
      return null;
    }
    if (selectedCount === 1) {
      const server = selectedServers[0];
      return server.config?.title || server.serverName;
    }
    return localize('com_ui_x_selected', { 0: selectedCount });
  }, [selectedServers, localize]);

  if (!manager) {
    return null;
  }

  const {
    isPinned,
    mcpValues,
    isInitializing,
    placeholderText,
    connectionStatus,
    getConfigDialogProps,
    toggleServerSelection,
    getServerStatusIconProps,
  } = manager;

  if (!isPinned && selectedNames.length === 0) {
    return null;
  }

  const configDialogProps = getConfigDialogProps();

  return (
    <>
      <Ariakit.MenuProvider store={menuStore}>
        <TooltipAnchor
          description={placeholderText}
          disabled={isOpen}
          render={
            <Ariakit.MenuButton
              className={cn(
                'group relative inline-flex items-center justify-center gap-theme-compact',
                'border border-border-medium text-sm font-medium transition-all',
                'h-theme-control min-w-theme-control rounded-theme-control-round bg-transparent px-2.5 shadow-sm',
                'hover:bg-surface-hover hover:shadow-md active:shadow-inner',
                'md:w-fit md:justify-start md:px-theme-normal',
                isOpen && 'bg-surface-hover',
              )}
            />
          }
        >
          <StackedMCPIcons selectedServers={selectedServers} maxIcons={3} iconSize="sm" />
          <span className="hidden truncate text-text-primary md:block">
            {displayText || placeholderText}
          </span>
          <ChevronDown
            className={cn(
              'hidden h-3 w-3 text-text-secondary transition-transform md:block',
              isOpen && 'rotate-180',
            )}
          />
        </TooltipAnchor>

        <Ariakit.Menu
          portal={true}
          gutter={8}
          modal={true}
          unmountOnHide={true}
          aria-label={localize('com_ui_mcp_servers')}
          className={cn(
            'z-50 flex min-w-[260px] max-w-[320px] flex-col rounded-xl',
            'border border-border-light bg-presentation p-1.5 shadow-lg',
            'origin-top opacity-0 transition-[opacity,transform] duration-200 ease-out',
            'data-[enter]:scale-100 data-[enter]:opacity-100',
            'scale-95 data-[leave]:scale-95 data-[leave]:opacity-0',
          )}
        >
          <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
            {visibleServers.map((server) => (
              <MCPServerMenuItem
                key={server.serverName}
                server={server}
                isSelected={mcpValues?.includes(server.serverName) ?? false}
                connectionStatus={connectionStatus}
                isInitializing={isInitializing}
                statusIconProps={getServerStatusIconProps(server.serverName)}
                onToggle={toggleServerSelection}
                toolList={tarsMcpTools?.getDomainTools(server.serverName)}
                selectedToolKeys={tarsMcpTools?.getSelectedToolKeys(server.serverName)}
                onToggleTool={tarsMcpTools?.toggleToolSelection}
              />
            ))}
            {(tarsMcpTools?.pendingServers?.length ?? 0) > 0 && (
              <>
                <div className="mt-1 border-t border-border-light pt-1.5">
                  <span className="px-2.5 text-xs font-medium text-text-secondary">
                    {localize('com_ui_tars_mcp_available_servers')}
                  </span>
                </div>
                {tarsMcpTools?.pendingServers.map((server) => (
                  <MCPPendingServerItem
                    key={server.id}
                    server={server}
                    isEnabling={tarsMcpTools.enablingServerId === server.id}
                    onEnable={tarsMcpTools.enableServer}
                  />
                ))}
              </>
            )}
          </div>
        </Ariakit.Menu>
      </Ariakit.MenuProvider>
      {configDialogProps && (
        <MCPConfigDialog
          {...configDialogProps}
          conversationId={conversationId}
          storageContextKey={storageContextKey}
        />
      )}
    </>
  );
}

function MCPSelect() {
  const context = useBadgeRowContext();
  const { selectableServers } = context?.mcpServerManager ?? {};
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });

  /** Brain-approved servers awaiting opt-in still need the menu as their entry point. */
  const hasEntries =
    (selectableServers?.length ?? 0) > 0 ||
    (context?.tarsMcpTools?.pendingServers?.length ?? 0) > 0;

  if (!canUseMcp || !hasEntries) {
    return null;
  }

  return <MCPSelectContent />;
}

export default memo(MCPSelect);
