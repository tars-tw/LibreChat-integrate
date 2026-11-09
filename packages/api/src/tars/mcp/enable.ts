import { logger } from '@librechat/data-schemas';
import type { TarsMcpUserServer } from './user';
import { getUserTarsMcpSettings, updateUserTarsMcpServer } from './user';

/**
 * My Tools opt-in on someone's behalf: for the people an agent is shared with, and for
 * the people an admin newly assigns a server to. pwc_tars defaults every server to
 * off, and the gateway lists a server's tools only once the user turns it on, so the
 * server would stay out of their agents (and the Agent Builder tool list) until each
 * person found it in My Tools. Both paths turn it on for them through the same
 * per-user settings API the page uses. A server that needs personal credentials is
 * never turned on this way, saved or not: it stays the person's own switch.
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
 * nothing to change: already on, or a server that needs personal credentials (left to
 * the user even once they saved theirs). `tool_config` is sent only when it changes,
 * since pwc_tars overwrites it whole.
 */
export function enableUpdateFor(
  server: TarsMcpUserServer,
  bound: TarsBoundServer,
): ServerUpdate | null {
  if (server.requires_user_credentials) {
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

/**
 * Turns each user's servers on; one user's failure does not stop the rest. `reason`
 * names what asked for it in the log.
 */
export async function enableTarsServersFor(
  plan: Map<string, TarsBoundServer[]>,
  reason: string,
): Promise<void> {
  const entries = [...plan.entries()];
  for (let start = 0; start < entries.length; start += ENABLE_BATCH_SIZE) {
    const batch = entries.slice(start, start + ENABLE_BATCH_SIZE);
    await Promise.all(
      batch.map(async ([tarsUserId, servers]) => {
        try {
          const enabled = await enableForUser(tarsUserId, servers);
          if (enabled > 0) {
            logger.info(
              `[tars-mcp] Turned on ${enabled} MCP server(s) for pwc_tars user ${tarsUserId} after ${reason}`,
            );
          }
        } catch (error) {
          logger.warn(
            `[tars-mcp] Failed to turn on MCP servers for pwc_tars user ${tarsUserId} after ${reason}`,
            error,
          );
        }
      }),
    );
  }
}

/** Turns the same bound servers on for every user, as an agent share does. */
export function enableTarsBoundServers(
  tarsUserIds: string[],
  bound: TarsBoundServer[],
): Promise<void> {
  return enableTarsServersFor(new Map(tarsUserIds.map((id) => [id, bound])), 'an agent share');
}
