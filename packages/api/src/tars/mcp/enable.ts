import { logger } from '@librechat/data-schemas';
import type { TarsMcpUserServer } from './user';
import { getUserTarsMcpSettings, updateUserTarsMcpServer } from './user';

/**
 * My Tools opt-in for the people an agent is shared with. pwc_tars defaults every
 * server to off, and the gateway lists a server's tools only once the user turns it
 * on, so a shared agent's MCP tools would not load until each person found the
 * server in My Tools. Sharing turns it on for them through the same per-user
 * settings API the page uses; a server that needs credentials only the user can
 * give stays off.
 */

/** A server an agent binds, as pwc_tars ids; no tool ids binds the whole server. */
export interface TarsBoundServer {
  mcp_server_id: string;
  mcp_tool_ids: string[];
}

type ToolConfig = Record<string, boolean>;

interface ServerUpdate {
  is_enabled: true;
  tool_config?: ToolConfig;
}

/** People whose settings are written at once, to bound the fan-out a group share causes. */
const ENABLE_BATCH_SIZE = 5;

/** `tool_config` without the switched-off tools among `toolNames`; `null` turns every tool on. */
function withToolsOn(toolConfig: ToolConfig, toolNames: Set<string> | null): ToolConfig {
  return Object.fromEntries(
    Object.entries(toolConfig).filter(
      ([name, enabled]) => enabled !== false || (toolNames != null && !toolNames.has(name)),
    ),
  );
}

/**
 * The write that lets a user run what `bound` names on `server`, or null when there is
 * nothing to change: already on, or waiting on credentials only the user can give.
 * `tool_config` is sent only when it changes, since pwc_tars overwrites it whole.
 */
export function enableUpdateFor(
  server: TarsMcpUserServer,
  bound: TarsBoundServer,
): ServerUpdate | null {
  if (server.requires_user_credentials && !server.has_credentials) {
    return null;
  }
  const wanted = new Set(bound.mcp_tool_ids);
  const toolNames =
    wanted.size === 0
      ? null
      : new Set(server.tools.flatMap((tool) => (wanted.has(tool.id) ? [tool.name] : [])));
  const current = server.tool_config ?? {};
  const toolConfig = withToolsOn(current, toolNames);
  const toolsChanged = Object.keys(toolConfig).length !== Object.keys(current).length;
  if (server.user_enabled && !toolsChanged) {
    return null;
  }
  return toolsChanged ? { is_enabled: true, tool_config: toolConfig } : { is_enabled: true };
}

/** Turns the bound servers on for one user; servers not assigned to them are skipped. */
async function enableForUser(tarsUserId: string, bound: TarsBoundServer[]): Promise<number> {
  const settings = await getUserTarsMcpSettings(tarsUserId);
  const byId = new Map(settings.map((server) => [server.id, server]));
  let enabled = 0;
  for (const server of bound) {
    const setting = byId.get(server.mcp_server_id);
    const update = setting ? enableUpdateFor(setting, server) : null;
    if (update) {
      await updateUserTarsMcpServer(tarsUserId, server.mcp_server_id, update);
      enabled += 1;
    }
  }
  return enabled;
}

/** Turns the bound servers on for every user; one user's failure does not stop the rest. */
export async function enableTarsBoundServers(
  tarsUserIds: string[],
  bound: TarsBoundServer[],
): Promise<void> {
  for (let start = 0; start < tarsUserIds.length; start += ENABLE_BATCH_SIZE) {
    const batch = tarsUserIds.slice(start, start + ENABLE_BATCH_SIZE);
    await Promise.all(
      batch.map(async (tarsUserId) => {
        try {
          const enabled = await enableForUser(tarsUserId, bound);
          if (enabled > 0) {
            logger.info(
              `[tars-mcp] Turned on ${enabled} MCP server(s) for pwc_tars user ${tarsUserId} after an agent share`,
            );
          }
        } catch (error) {
          logger.warn(
            `[tars-mcp] Failed to turn on shared MCP servers for pwc_tars user ${tarsUserId}`,
            error,
          );
        }
      }),
    );
  }
}
