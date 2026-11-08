import { useMemo, createContext, useContext } from 'react';
import {
  EModelEndpoint,
  normalizeServerName,
  isTarsPluginToolName,
  isWorkflowMcpServerName,
} from 'librechat-data-provider';
import type { MCPServersListResponse, TPlugin } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { useAvailableToolsQuery, useMCPServersQuery } from '~/data-provider';
import { useCatalogReady } from '~/hooks/useCatalogWarmup';

const EMPTY_LABELS: ReadonlyMap<string, string> = new Map();

const TarsPluginLabelsContext = createContext<ReadonlyMap<string, string>>(EMPTY_LABELS);

const toPluginLabels = (tools: TPlugin[]): ReadonlyMap<string, string> => {
  const labels = new Map<string, string>();
  for (const tool of tools) {
    if (isTarsPluginToolName(tool.pluginKey) && tool.name) {
      labels.set(tool.pluginKey, tool.name);
    }
  }
  return labels;
};

/**
 * Each Workflow server's title (its Langflow project), keyed the way a tool key names the server:
 * the key is `workflow_<project id>`, which says nothing to the reader of a tool card.
 */
const toWorkflowServerLabels = (servers: MCPServersListResponse): ReadonlyMap<string, string> => {
  const labels = new Map<string, string>();
  for (const [serverName, config] of Object.entries(servers)) {
    if (isWorkflowMcpServerName(serverName) && config.title) {
      labels.set(normalizeServerName(serverName), config.title);
    }
  }
  return labels;
};

/**
 * Serves each pwc_tars plugin tool's (`tars_plugin_<name>`) manifest display
 * name, read off the agent-builder tool listing the server already serves, so
 * a plugin's tool call is titled as the builder lists it, and each Workflow
 * MCP server's project name under its server key. The server list waits for the
 * catalog warmup, as the other observers mounted from messages do.
 */
export function TarsPluginLabelsProvider({
  enabled,
  children,
}: {
  /** Whether the deployment is linked to pwc_tars (`startupConfig.tarsAuth`). */
  enabled: boolean;
  children: ReactNode;
}) {
  const { data: pluginLabels } = useAvailableToolsQuery<ReadonlyMap<string, string>>(
    EModelEndpoint.agents,
    { enabled, select: toPluginLabels },
  );
  const mcpServersReady = useCatalogReady('mcpServers');
  const { data: serverLabels } = useMCPServersQuery<ReadonlyMap<string, string>>({
    enabled: mcpServersReady,
    select: toWorkflowServerLabels,
  });
  const labels = useMemo(() => {
    if (!serverLabels?.size) {
      return pluginLabels ?? EMPTY_LABELS;
    }
    return pluginLabels?.size ? new Map([...pluginLabels, ...serverLabels]) : serverLabels;
  }, [pluginLabels, serverLabels]);
  return (
    <TarsPluginLabelsContext.Provider value={labels}>{children}</TarsPluginLabelsContext.Provider>
  );
}

/** Empty outside the provider; labels then fall back to the plugin or server name (`getToolDisplayLabel`). */
export function useTarsPluginLabels(): ReadonlyMap<string, string> {
  return useContext(TarsPluginLabelsContext);
}
