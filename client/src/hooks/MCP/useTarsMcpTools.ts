import { useCallback, useEffect, useMemo } from 'react';
import { useAtom } from 'jotai';
import isEqual from 'lodash/isEqual';
import { useSetRecoilState } from 'recoil';
import { Constants, LocalStorageKeys, TARS_MCP_SERVER_PREFIX } from 'librechat-data-provider';
import type { TTarsMcpDomainTool, TTarsMcpDomainServer } from 'librechat-data-provider';
import { ephemeralAgentByConvoId, mcpValuesAtomFamily, mcpToolValuesAtomFamily } from '~/store';
import { useSelectedTarsDomain } from '~/components/Chat/Menus/Tars/domain';
import { useTarsMcpDomainToolsQuery } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { setTimestamp } from '~/utils/timestamps';

/** Only the injected per-server entries are brain-scoped — the legacy `tars` aggregate is not. */
const isScopedServerName = (serverName: string): boolean =>
  serverName.startsWith(TARS_MCP_SERVER_PREFIX);

export interface TarsMcpToolsControl {
  /** Whether a `tars_*` dropdown entry may show for the active brain (fail-open while loading). */
  isServerAllowed: (serverName: string) => boolean;
  /** The active brain's usable tools for one gateway server; undefined for non-tars servers. */
  getDomainTools: (serverName: string) => TTarsMcpDomainTool[] | undefined;
  /** Checked tool keys of one server; `null` means every tool is checked. */
  getSelectedToolKeys: (serverName: string) => Set<string> | null;
  toggleToolSelection: (serverName: string, toolKey: string) => void;
}

/**
 * Chat-scoped per-tool MCP selection for the pwc_tars gateway entries, keyed by
 * the conversation's brain (domain). Mirrors pwc_tars: the dropdown only offers
 * the brain's whitelisted servers/tools, every tool starts checked, and the
 * checked subset is mirrored into `ephemeralAgent.mcp_tools` so the backend
 * equips exactly those tools. Must be called inside ChatContext (BadgeRow).
 */
export default function useTarsMcpTools({
  conversationId,
  storageContextKey,
}: {
  conversationId?: string | null;
  storageContextKey?: string;
} = {}): TarsMcpToolsControl {
  const key = conversationId ?? Constants.NEW_CONVO;
  const isNewConvo = key === Constants.NEW_CONVO;
  /** Same atom-key derivation as `useMCPSelect` so both hooks share state. */
  const atomKey = isNewConvo && storageContextKey ? storageContextKey : key;

  const { user } = useAuthContext();
  const isTarsUser = user?.provider === 'tars';
  const { selectedId } = useSelectedTarsDomain();
  const { data: domainServers } = useTarsMcpDomainToolsQuery(
    isTarsUser && selectedId !== '' ? selectedId : null,
  );

  const serversByName = useMemo(() => {
    const map = new Map<string, TTarsMcpDomainServer>();
    for (const server of domainServers ?? []) {
      map.set(server.gateway_name, server);
    }
    return map;
  }, [domainServers]);

  const [mcpValues, setMCPValuesRaw] = useAtom(mcpValuesAtomFamily(atomKey));
  const [toolValues, setToolValuesRaw] = useAtom(mcpToolValuesAtomFamily(atomKey));
  const setEphemeralAgent = useSetRecoilState(ephemeralAgentByConvoId(key));

  /** Single write path keeping the jotai atoms, the ephemeral agent, and the
   *  new-conversation environment keys consistent. `nextMcp: null` = unchanged. */
  const commit = useCallback(
    (nextMcp: string[] | null, nextTools: Record<string, string[]>) => {
      if (nextMcp != null && !isEqual(nextMcp, mcpValues)) {
        setMCPValuesRaw(nextMcp);
      }
      if (!isEqual(nextTools, toolValues)) {
        setToolValuesRaw(nextTools);
      }
      setEphemeralAgent((prev) => {
        const mcpChanged = nextMcp != null && !isEqual(prev?.mcp, nextMcp);
        const toolsChanged = !isEqual(prev?.mcp_tools ?? {}, nextTools);
        if (!mcpChanged && !toolsChanged) {
          return prev;
        }
        const next = { ...(prev ?? {}), mcp_tools: nextTools };
        if (nextMcp != null) {
          next.mcp = nextMcp;
        }
        return next;
      });
      if (storageContextKey != null && storageContextKey !== '') {
        localStorage.setItem(
          `${LocalStorageKeys.LAST_MCP_TOOLS_}${storageContextKey}`,
          JSON.stringify(nextTools),
        );
        if (nextMcp != null) {
          const envKey = `${LocalStorageKeys.LAST_MCP_}${storageContextKey}`;
          localStorage.setItem(envKey, JSON.stringify(nextMcp));
          setTimestamp(envKey);
        }
      }
    },
    [
      mcpValues,
      toolValues,
      setMCPValuesRaw,
      setToolValuesRaw,
      setEphemeralAgent,
      storageContextKey,
    ],
  );

  /**
   * Reconcile selection with the active brain: deselect gateway servers the
   * brain may not use, drop stale tool keys, and materialize the full tool
   * whitelist for every selected server (all checked by default) so the
   * backend loads exactly the brain's tools.
   */
  useEffect(() => {
    if (!isTarsUser || domainServers == null) {
      return;
    }
    const nextMcp = mcpValues.filter(
      (name) => !isScopedServerName(name) || serversByName.has(name),
    );
    const nextTools: Record<string, string[]> = {};
    for (const name of nextMcp) {
      const server = serversByName.get(name);
      if (server == null || server.tools.length === 0) {
        continue;
      }
      const domainKeys = server.tools.map((tool) => tool.tool_key);
      const domainSet = new Set(domainKeys);
      const stored = toolValues[name];
      const kept =
        Array.isArray(stored) && stored.length > 0
          ? stored.filter((toolKey) => domainSet.has(toolKey))
          : domainKeys;
      nextTools[name] = kept.length > 0 ? kept : domainKeys;
    }
    commit(nextMcp.length === mcpValues.length ? null : nextMcp, nextTools);
  }, [isTarsUser, domainServers, serversByName, mcpValues, toolValues, commit]);

  const isServerAllowed = useCallback(
    (serverName: string): boolean => {
      if (!isTarsUser || !isScopedServerName(serverName) || domainServers == null) {
        return true;
      }
      return serversByName.has(serverName);
    },
    [isTarsUser, domainServers, serversByName],
  );

  const getDomainTools = useCallback(
    (serverName: string): TTarsMcpDomainTool[] | undefined => serversByName.get(serverName)?.tools,
    [serversByName],
  );

  const getSelectedToolKeys = useCallback(
    (serverName: string): Set<string> | null => {
      const stored = toolValues[serverName];
      if (Array.isArray(stored) && stored.length > 0) {
        return new Set(stored);
      }
      return null;
    },
    [toolValues],
  );

  const toggleToolSelection = useCallback(
    (serverName: string, toolKey: string) => {
      const server = serversByName.get(serverName);
      if (server == null) {
        return;
      }
      const domainKeys = server.tools.map((tool) => tool.tool_key);
      const stored = toolValues[serverName];
      const current = Array.isArray(stored) && stored.length > 0 ? stored : domainKeys;
      const next = current.includes(toolKey)
        ? current.filter((storedKey) => storedKey !== toolKey)
        : [...current, toolKey];
      /** Unchecking the last tool deselects the server itself. */
      if (next.length === 0) {
        const { [serverName]: _removed, ...rest } = toolValues;
        commit(
          mcpValues.filter((name) => name !== serverName),
          rest,
        );
        return;
      }
      commit(null, { ...toolValues, [serverName]: next });
    },
    [serversByName, toolValues, mcpValues, commit],
  );

  return { isServerAllowed, getDomainTools, getSelectedToolKeys, toggleToolSelection };
}
