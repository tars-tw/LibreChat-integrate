import { createContext, useContext } from 'react';
import { EModelEndpoint, isTarsPluginToolName } from 'librechat-data-provider';
import type { TPlugin } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { useAvailableToolsQuery } from '~/data-provider';

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
 * Serves each pwc_tars plugin tool's (`tars_plugin_<name>`) manifest display
 * name, read off the agent-builder tool listing the server already serves, so
 * a plugin's tool call is titled as the builder lists it.
 */
export function TarsPluginLabelsProvider({
  enabled,
  children,
}: {
  /** Whether the deployment is linked to pwc_tars (`startupConfig.tarsAuth`). */
  enabled: boolean;
  children: ReactNode;
}) {
  const { data } = useAvailableToolsQuery<ReadonlyMap<string, string>>(EModelEndpoint.agents, {
    enabled,
    select: toPluginLabels,
  });
  return (
    <TarsPluginLabelsContext.Provider value={data ?? EMPTY_LABELS}>
      {children}
    </TarsPluginLabelsContext.Provider>
  );
}

/** Empty outside the provider; labels then fall back to the plugin name (`getToolDisplayLabel`). */
export function useTarsPluginLabels(): ReadonlyMap<string, string> {
  return useContext(TarsPluginLabelsContext);
}
