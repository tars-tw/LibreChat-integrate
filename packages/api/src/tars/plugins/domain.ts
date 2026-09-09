import { logger } from '@librechat/data-schemas';
import { enabledTarsPluginFunctions, tarsPluginNameFromToolName } from 'librechat-data-provider';
import { fetchTarsDomainById } from '~/tars/domains';
import { primeTarsPluginManifests } from './client';

export interface TarsPluginScope {
  /** pwc_tars user the chat runs as; nothing is allowed without one. */
  tarsUserId?: string;
  /** The active 專用腦 whose `domain_functions` decides what is offered. */
  domainId?: string | number | null;
}

/**
 * Plugin names the active brain switches on for this user. Resolved through
 * the user's own domain list, so a brain outside their role grants allows
 * nothing — and neither does a missing brain: pwc_tars' chat resolves plugin
 * tools from the domain too and offers none without one.
 */
export async function allowedTarsPluginNames(scope: TarsPluginScope): Promise<Set<string>> {
  const { tarsUserId, domainId } = scope;
  if (!tarsUserId || domainId == null || domainId === '') {
    return new Set();
  }
  const domain = await fetchTarsDomainById(tarsUserId, domainId);
  return new Set(enabledTarsPluginFunctions(domain?.domain_functions).map((entry) => entry.name));
}

/**
 * The plugin tool names among `toolNames` this turn may equip: the brain must
 * offer the plugin and pwc_tars must have it loaded. The port of pwc_tars'
 * `resolve_plugin_tool_names` — a client cannot switch on more than the admin
 * did, and a plugin dropped from the folder disappears. Fails closed on any
 * pwc_tars error, since an unknown allowlist is not an allowlist.
 */
export async function resolveTarsPluginToolNames(
  toolNames: string[],
  scope: TarsPluginScope,
): Promise<Set<string>> {
  const requested = new Map<string, string>();
  for (const toolName of toolNames) {
    const pluginName = tarsPluginNameFromToolName(toolName);
    if (pluginName) {
      requested.set(toolName, pluginName);
    }
  }
  if (requested.size === 0) {
    return new Set();
  }
  try {
    const [allowed, manifests] = await Promise.all([
      allowedTarsPluginNames(scope),
      primeTarsPluginManifests(),
    ]);
    const resolved = new Set<string>();
    for (const [toolName, pluginName] of requested) {
      if (!allowed.has(pluginName)) {
        logger.warn(
          `[tars-plugins] "${pluginName}" is not enabled for domain ${scope.domainId}; dropped`,
        );
        continue;
      }
      if (!manifests.has(pluginName)) {
        logger.warn(`[tars-plugins] "${pluginName}" is not loaded by pwc_tars; dropped`);
        continue;
      }
      resolved.add(toolName);
    }
    return resolved;
  } catch (error) {
    logger.warn('[tars-plugins] Failed to resolve the plugin allowlist; equipping none', error);
    return new Set();
  }
}
