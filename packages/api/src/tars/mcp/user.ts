import { logger } from '@librechat/data-schemas';
import { Constants, TARS_MCP_SERVER_PREFIX } from 'librechat-data-provider';
import type { TarsAvailableToolRow } from './client';
import {
  tarsMcpFetch,
  buildScopedToolName,
  PROXIED_SERVER_TYPES,
  invalidateTarsMcpToolsCache,
} from './client';
import { isTarsMcpEnabled } from './config';
import { gatewayNameFor } from './names';

/**
 * Per-user proxy for the pwc_tars MCP user panel: aggregated settings
 * (servers/tools assigned to the user or their groups via `sys_mcp_permission`,
 * with the user's enable states), server/tool
 * toggles, and credential save/clear with pwc_tars-side verification. All
 * writes invalidate the gateway tool cache so chat reflects changes
 * immediately instead of after the 30s TTL.
 */

export interface TarsMcpUserTool {
  id: string;
  name: string;
  description?: string | null;
  input_schema?: Record<string, unknown> | null;
  user_enabled: boolean;
}

export interface TarsMcpUserServer {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  type: string;
  is_enabled: boolean;
  user_enabled: boolean;
  requires_user_credentials: boolean;
  has_credentials: boolean;
  auth_type: string;
  login_fields: string[];
  tools: TarsMcpUserTool[];
  /** Injected `mcpConfig` entry name; absent when the server has no chat entry. */
  gateway_name?: string;
}

export interface TarsMcpCredentialsResult {
  has_credentials?: boolean;
  domain_id?: number;
  auth_check?: Record<string, unknown>;
  tools_synced?: Record<string, unknown>;
}

export interface TarsMcpDomainTool {
  name: string;
  description?: string | null;
  tool_key: string;
}

export interface TarsMcpDomainServer {
  id: string;
  name: string;
  code?: string | null;
  type: string;
  gateway_name: string;
  /**
   * Whether the user has opted this server in (`sys_user_mcp.is_enabled`).
   * pwc_tars defaults servers to OFF, so an assigned server stays unusable
   * until the user enables it — `false` entries carry no `tools` and exist so
   * the chat menu can offer that opt-in instead of hiding the server.
   */
  user_enabled: boolean;
  /** Tools the assignment grants; only populated once `user_enabled` is true. */
  tools: TarsMcpDomainTool[];
  /** How many tools the assignment grants, known even while the server is opted out. */
  tool_count?: number;
}

/**
 * The MCP servers assigned to the user (directly or through an active group),
 * split by the user's opt-in state. No brain (domain) is involved any more.
 *
 * Opted-in servers come from `available-tools?user_id`, so their tool lists are
 * exactly what pwc_tars authorizes (the `sys_mcp_permission` grants incl.
 * `mcp_tool_ids`, plus the user's own server/tool toggles) — no filtering is
 * reimplemented here. Each tool carries the full LibreChat tool key
 * (`<scoped name>_mcp_<gateway name>`), matching what the per-server gateway
 * advertises, so the chat frontend can whitelist tools on the ephemeral agent
 * without further mapping.
 *
 * Servers the user has NOT opted into are dropped from `available-tools`, so they
 * are read from the user's own settings (already limited to their grants) —
 * otherwise an assigned server would vanish from chat with no hint it exists.
 */
export async function getUserTarsMcpTools(tarsUserId: string): Promise<TarsMcpDomainServer[]> {
  const [rows, settings] = await Promise.all([
    tarsMcpFetch<TarsAvailableToolRow[]>('/api/mcp/available-tools', {
      query: { user_id: tarsUserId },
    }),
    getUserTarsMcpSettings(tarsUserId).catch(() => []),
  ]);

  const servers = new Map<string, TarsMcpDomainServer>();
  const takenByServer = new Map<string, Set<string>>();
  const skipped = new Set<string>();
  for (const row of rows ?? []) {
    if (!PROXIED_SERVER_TYPES.has(row.server_type) || skipped.has(row.server_id)) {
      continue;
    }
    let server = servers.get(row.server_id);
    if (!server) {
      const gatewayName = gatewayNameFor(row.server_id, row.server_code);
      if (gatewayName == null) {
        skipped.add(row.server_id);
        continue;
      }
      server = {
        id: row.server_id,
        name: row.server_name,
        code: row.server_code ?? null,
        type: row.server_type,
        gateway_name: gatewayName,
        user_enabled: true,
        tools: [],
      };
      servers.set(row.server_id, server);
      takenByServer.set(row.server_id, new Set());
    }
    const taken = takenByServer.get(row.server_id) as Set<string>;
    const scopedName = buildScopedToolName(row, taken, server.gateway_name);
    if (!scopedName) {
      continue;
    }
    taken.add(scopedName);
    server.tools.push({
      name: row.tool_name,
      description: row.description ?? null,
      tool_key: `${scopedName}${Constants.mcp_delimiter}${server.gateway_name}`,
    });
  }

  /** Authoritative opt-in state: a server can be enabled yet contribute no rows
   *  above (every tool individually disabled), and that is not a pending server. */
  for (const setting of settings) {
    if (setting.user_enabled || servers.has(setting.id)) {
      continue;
    }
    if (setting.is_enabled === false || !PROXIED_SERVER_TYPES.has(setting.type)) {
      continue;
    }
    if (setting.gateway_name == null) {
      continue;
    }
    servers.set(setting.id, {
      id: setting.id,
      name: setting.name,
      code: setting.code ?? null,
      type: setting.type,
      gateway_name: setting.gateway_name,
      user_enabled: false,
      tools: [],
      tool_count: setting.tools.length,
    });
  }

  return [...servers.values()];
}

export async function getUserTarsMcpSettings(tarsUserId: string): Promise<TarsMcpUserServer[]> {
  const servers = await tarsMcpFetch<TarsMcpUserServer[]>('/api/mcp/user-settings', {
    query: { user_id: tarsUserId },
  });
  /** The chat dropdown matches on the injected entry name, which a server
   *  without a `code` cannot be derived back to — carry it explicitly. */
  return (servers ?? []).map((server) => ({
    ...server,
    gateway_name: gatewayNameFor(server.id, server.code) ?? undefined,
  }));
}

/** Only the injected per-server entries are assignment-scoped; the legacy `tars` aggregate is not. */
const isGatewayEntry = (serverName: string): boolean =>
  serverName.startsWith(TARS_MCP_SERVER_PREFIX);

async function visibleGatewayNames(tarsUserId?: string | null): Promise<Set<string>> {
  if (!tarsUserId) {
    return new Set();
  }
  try {
    const servers = await getUserTarsMcpSettings(tarsUserId);
    return new Set(
      servers.flatMap((server) =>
        server.user_enabled && server.gateway_name != null ? [server.gateway_name] : [],
      ),
    );
  } catch (error) {
    logger.warn(
      `[tars-mcp] Failed to read MCP settings for pwc_tars user ${tarsUserId}; hiding gateway entries`,
      error,
    );
    return new Set();
  }
}

/**
 * Narrows a resolved MCP config map to the `tars_*` gateway entries the user
 * may see: assigned to them or an active group (`sys_mcp_permission`) and opted
 * in. The config itself is shared by every user, so a listing that skips this
 * hands the whole pwc_tars catalog to anyone. Fails closed: an unlinked account
 * or an unreachable pwc_tars lists no gateway entry. Other servers pass through,
 * and a config without gateway entries costs no pwc_tars call.
 */
export async function filterVisibleTarsMcpConfigs<T>(
  configs: Record<string, T>,
  tarsUserId?: string | null,
): Promise<Record<string, T>> {
  if (!isTarsMcpEnabled() || !Object.keys(configs).some(isGatewayEntry)) {
    return configs;
  }
  const visible = await visibleGatewayNames(tarsUserId);
  return Object.fromEntries(
    Object.entries(configs).filter(([name]) => !isGatewayEntry(name) || visible.has(name)),
  );
}

export async function updateUserTarsMcpServer(
  tarsUserId: string,
  serverId: string,
  updates: { is_enabled?: boolean; tool_config?: Record<string, boolean> },
): Promise<void> {
  await tarsMcpFetch('/api/mcp/user-settings', {
    method: 'PUT',
    body: { user_id: tarsUserId, server_id: serverId, ...updates },
  });
  invalidateTarsMcpToolsCache();
}

/** Saves credentials; pwc_tars verifies against the live API before persisting. */
export async function saveUserTarsMcpCredentials(
  tarsUserId: string,
  serverId: string,
  credentials: Record<string, string>,
): Promise<TarsMcpCredentialsResult | undefined> {
  const result = await tarsMcpFetch<TarsMcpCredentialsResult>(
    '/api/mcp/user-settings/credentials',
    {
      method: 'PUT',
      body: { user_id: tarsUserId, server_id: serverId, credentials },
      timeoutMs: 60_000,
    },
  );
  invalidateTarsMcpToolsCache();
  return result;
}

export async function clearUserTarsMcpCredentials(
  tarsUserId: string,
  serverId: string,
): Promise<void> {
  await tarsMcpFetch('/api/mcp/user-settings/credentials', {
    method: 'DELETE',
    body: { user_id: tarsUserId, server_id: serverId },
  });
  invalidateTarsMcpToolsCache();
}
