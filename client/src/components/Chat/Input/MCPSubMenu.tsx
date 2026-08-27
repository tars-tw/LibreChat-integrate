import React from 'react';
import * as Ariakit from '@ariakit/react';
import { ChevronRight } from 'lucide-react';
import { MCPIcon, PinIcon } from '@librechat/client';
import { TARS_SQL_MCP_SERVER_NAME } from 'librechat-data-provider';
import MCPPendingServerItem from '~/components/MCP/MCPPendingServerItem';
import MCPServerMenuItem from '~/components/MCP/MCPServerMenuItem';
import MCPConfigDialog from '~/components/MCP/MCPConfigDialog';
import { useBadgeRowContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MCPSubMenuProps extends React.HTMLAttributes<HTMLButtonElement> {
  placeholder?: string;
}

const MCPSubMenu = React.forwardRef<HTMLButtonElement, MCPSubMenuProps>(
  ({ placeholder, className, ...props }, ref) => {
    const localize = useLocalize();
    const context = useBadgeRowContext();
    const { storageContextKey, mcpServerManager, tarsMcpTools } = context ?? {};

    const menuStore = Ariakit.useMenuStore({
      focusLoop: true,
      showTimeout: 100,
      placement: 'right',
    });

    if (!mcpServerManager) {
      return null;
    }

    const {
      isPinned,
      mcpValues,
      setIsPinned,
      isInitializing,
      placeholderText,
      connectionStatus,
      selectableServers,
      getConfigDialogProps,
      toggleServerSelection,
      getServerStatusIconProps,
    } = mcpServerManager;

    /** The SQL agent has its own top-level row in the tools menu, so it is not
     *  offered a second time here. It stays in `selectableServers` because that
     *  list is what keeps its selection state alive. */
    const listedServers = selectableServers.filter(
      (server) => server.serverName !== TARS_SQL_MCP_SERVER_NAME,
    );
    const visibleServers = tarsMcpTools
      ? listedServers.filter((server) => tarsMcpTools.isServerAllowed(server.serverName))
      : listedServers;
    const pendingServers = tarsMcpTools?.pendingServers ?? [];

    if (visibleServers.length === 0 && pendingServers.length === 0) {
      return null;
    }

    const configDialogProps = getConfigDialogProps();

    return (
      <>
        <Ariakit.MenuProvider store={menuStore}>
          <Ariakit.MenuButton
            ref={ref}
            {...props}
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              menuStore.toggle();
            }}
            className={cn(
              'flex w-full cursor-pointer items-center justify-between rounded-lg p-2 hover:bg-surface-hover',
              className,
            )}
          >
            <div className="flex items-center gap-2">
              <MCPIcon className="h-5 w-5 flex-shrink-0 text-text-primary" aria-hidden="true" />
              <span>{placeholder || placeholderText}</span>
              <ChevronRight className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsPinned(!isPinned);
              }}
              className={cn(
                'rounded p-1 transition-all duration-200',
                'hover:bg-surface-tertiary hover:shadow-sm',
                !isPinned && 'text-text-secondary hover:text-text-primary',
              )}
              aria-label={isPinned ? localize('com_ui_unpin') : localize('com_ui_pin')}
            >
              <div className="h-4 w-4">
                <PinIcon unpin={isPinned} />
              </div>
            </button>
          </Ariakit.MenuButton>

          <Ariakit.Menu
            portal={true}
            unmountOnHide={true}
            gutter={12}
            flip="left bottom-end top-end"
            aria-label={localize('com_ui_mcp_servers')}
            className={cn(
              'animate-popover-left z-40 flex min-w-[min(260px,calc(100vw-1rem))] max-w-[min(320px,calc(100vw-1rem))] flex-col rounded-xl',
              'border border-border-light bg-presentation p-1.5 shadow-lg',
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
              {pendingServers.length > 0 && tarsMcpTools && (
                <>
                  <div className="mt-1 border-t border-border-light pt-1.5">
                    <span className="px-2.5 text-xs font-medium text-text-secondary">
                      {localize('com_ui_tars_mcp_available_servers')}
                    </span>
                  </div>
                  {pendingServers.map((server) => (
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
          <MCPConfigDialog {...configDialogProps} storageContextKey={storageContextKey} />
        )}
      </>
    );
  },
);

MCPSubMenu.displayName = 'MCPSubMenu';

export default React.memo(MCPSubMenu);
