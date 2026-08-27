import { useCallback, useMemo } from 'react';
import { TARS_SQL_MCP_SERVER_NAME } from 'librechat-data-provider';
import type { useMCPServerManager } from './useMCPServerManager';
import useLocalStorage from '~/hooks/useLocalStorageAlt';

/** Its own pin preference, kept apart from the MCP dropdown's shared one. */
const PIN_STORAGE_KEY = 'pinTarsSqlAgent';

export interface TarsSqlAgentControl {
  /** Whether the loopback SQL-agent entry is offered to this user at all. */
  isAvailable: boolean;
  isActive: boolean;
  toggle: () => void;
  isPinned: boolean;
  setIsPinned: (value: boolean) => void;
}

/**
 * The pwc_tars SQL agent as a first-class chat tool, sitting beside web search
 * and code interpreter rather than inside the MCP submenu. Transport is still
 * the loopback MCP entry — this only lifts its toggle out of the MCP grouping,
 * so selection state stays a plain `ephemeralAgent.mcp` membership and every
 * server-side path is unchanged. Availability follows the manager's own
 * visibility rules, which already hide the entry from accounts not linked to
 * pwc_tars.
 */
export default function useTarsSqlAgent(
  manager: ReturnType<typeof useMCPServerManager>,
): TarsSqlAgentControl {
  const [isPinned, setIsPinned] = useLocalStorage<boolean>(PIN_STORAGE_KEY, false);

  const isAvailable = useMemo(
    () => manager.selectableServers.some((s) => s.serverName === TARS_SQL_MCP_SERVER_NAME),
    [manager.selectableServers],
  );
  const isActive = useMemo(
    () => manager.mcpValues?.includes(TARS_SQL_MCP_SERVER_NAME) ?? false,
    [manager.mcpValues],
  );

  const { toggleServerSelection } = manager;
  const toggle = useCallback(
    () => toggleServerSelection(TARS_SQL_MCP_SERVER_NAME),
    [toggleServerSelection],
  );

  return { isAvailable, isActive, toggle, isPinned, setIsPinned };
}
