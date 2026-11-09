import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, TARS_MCP_SERVER_PREFIX } from 'librechat-data-provider';
import { useMCPConnectionStatus } from './useMCPConnectionStatus';

/**
 * An OIDC server's tools come from the user's own connection, so the chat menu's list goes stale
 * the moment a sign-in completes, and those queries do not refetch by themselves. Refreshes them
 * whenever a `tars_*` entry newly connects, wherever the sign-in was started.
 */
export default function useTarsMcpConnectRefresh(enabled: boolean): void {
  const queryClient = useQueryClient();
  const { connectionStatus } = useMCPConnectionStatus({ enabled });
  const connected = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const current = new Set(
      Object.entries(connectionStatus ?? {}).flatMap(([name, status]) =>
        name.startsWith(TARS_MCP_SERVER_PREFIX) && status?.connectionState === 'connected'
          ? [name]
          : [],
      ),
    );
    const newlyConnected = [...current].some((name) => !connected.current.has(name));
    connected.current = current;
    if (newlyConnected) {
      queryClient.invalidateQueries([QueryKeys.tarsMcpChatTools]);
      queryClient.invalidateQueries([QueryKeys.tarsMcpUserSettings]);
    }
  }, [connectionStatus, queryClient]);
}
