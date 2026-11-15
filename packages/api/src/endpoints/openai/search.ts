import {
  Tools,
  EModelEndpoint,
  AgentCapabilities,
  defaultAgentCapabilities,
  isOpenAIWebSearchCountry,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

export interface NativeWebSearchSwap {
  /** Tool names left for `loadTools`, without LibreChat's `web_search`. */
  tools: string[];
  /** Whether the provider's own web search replaces it this turn. */
  native: boolean;
}

/**
 * Whether the built-in OpenAI endpoint runs web search on its own tool. The client
 * reads it from the startup config to offer the switch on OpenAI models without
 * LibreChat's search provider being configured.
 */
export function isOpenAINativeWebSearchEnabled(appConfig?: AppConfig): boolean {
  if (appConfig?.endpoints?.openAI?.nativeWebSearch !== true) {
    return false;
  }
  const capabilities =
    appConfig.endpoints.agents?.capabilities ?? (defaultAgentCapabilities as string[]);
  return capabilities.includes(AgentCapabilities.web_search);
}

/**
 * Hands the web search switch to OpenAI's own search when
 * `endpoints.openAI.nativeWebSearch` is on.
 *
 * Only the built-in `openAI` endpoint qualifies: a custom endpoint also runs on
 * the OpenAI client, but its provider may not offer the tool. Dropping the name
 * here also drops the capability check `loadTools` would have run on it, so the
 * `web_search` agent capability is checked instead. The caller sets the
 * `web_search` model parameter when `native` is true, so the provider builds the
 * tool and the `WEB_SEARCH.USE` gate on provider-native search applies.
 */
export function swapNativeWebSearch(
  provider: string | undefined,
  toolNames: string[],
  appConfig?: AppConfig,
): NativeWebSearchSwap {
  if (
    provider !== EModelEndpoint.openAI ||
    !toolNames.includes(Tools.web_search) ||
    !isOpenAINativeWebSearchEnabled(appConfig)
  ) {
    return { tools: toolNames, native: false };
  }
  return { tools: toolNames.filter((name) => name !== Tools.web_search), native: true };
}

function isOpenAIWebSearchTool<T>(tool: T): tool is T & { type: 'web_search' } {
  return (
    tool != null && typeof tool === 'object' && (tool as { type?: unknown }).type === 'web_search'
  );
}

/**
 * Places OpenAI's own web search in the country the chat picked (`user_location`).
 * Only a country in `OPENAI_WEB_SEARCH_COUNTRIES` is sent; anything else leaves
 * OpenAI to infer the location itself.
 */
export function locateNativeWebSearch<T>(
  tools: T[] | undefined,
  country: unknown,
): T[] | undefined {
  if (tools == null || !isOpenAIWebSearchCountry(country)) {
    return tools;
  }
  const user_location = { type: 'approximate', country } as const;
  return tools.map((tool) => (isOpenAIWebSearchTool(tool) ? { ...tool, user_location } : tool));
}
