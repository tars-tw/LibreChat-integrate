import { Constants } from 'librechat-data-provider';
import type { TarsDomainMcpRelation } from './admin';
import type { TarsAvailableToolRow } from './client';
import {
  tarsMcpFetch,
  buildScopedToolName,
  PROXIED_SERVER_TYPES,
  invalidateTarsMcpToolsCache,
} from './client';
import { fetchTarsDomainsForUser } from '~/tars/domains';
import { gatewayNameFor } from './names';

/**
 * Per-user proxy for the pwc_tars MCP user panel: aggregated settings
 * (domain-visible servers/tools with the user's enable states), server/tool
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
   * pwc_tars defaults servers to OFF, so a brain-approved server stays unusable
   * until the user enables it — `false` entries carry no `tools` and exist so
   * the chat menu can offer that opt-in instead of hiding the server.
   */
  user_enabled: boolean;
  /** Tools the brain grants; only populated once `user_enabled` is true. */
  tools: TarsMcpDomainTool[];
  /** How many tools the brain grants, known even while the server is opted out. */
  tool_count?: number;
}

/**
 * The MCP servers one domain (腦袋) grants, split by the user's opt-in state.
 *
 * Opted-in servers come from `available-tools?user_id&domain_id`, so their tool
 * lists are exactly what pwc_tars authorizes (domain whitelist incl.
 * `mcp_tool_ids`, plus the user's own `sys_user_mcp` server/tool toggles) —
 * no filtering is reimplemented here. Each tool carries the full LibreChat tool
 * key (`<scoped name>_mcp_<gateway name>`), matching what the per-server gateway
 * advertises, so the chat frontend can whitelist tools on the ephemeral agent
 * without further mapping.
 *
 * The brain's raw bindings are read separately to surface servers the user has
 * NOT opted into (pwc_tars defaults them off and drops them from
 * `available-tools`), which would otherwise vanish from chat with no hint that
 * the brain allows them. That read is unscoped to the user, so it is gated on
 * the domain being one of the user's own — an unauthorized id yields nothing.
 */
export async function getUserTarsDomainMcpTools(
  tarsUserId: string,
  domainId: number,
): Promise<TarsMcpDomainServer[]> {
  const [domains, rows, relations, settings] = await Promise.all([
    fetchTarsDomainsForUser(tarsUserId),
    tarsMcpFetch<TarsAvailableToolRow[]>('/api/mcp/available-tools', {
      query: { user_id: tarsUserId, domain_id: domainId },
    }),
    tarsMcpFetch<TarsDomainMcpRelation[]>(`/api/mcp/domain/${domainId}/servers`).catch(() => []),
    getUserTarsMcpSettings(tarsUserId).catch(() => []),
  ]);
  if (!domains.some((domain) => domain.id === domainId)) {
    return [];
  }
  /** Authoritative opt-in state: a server can be enabled yet contribute no rows
   *  above (every tool individually disabled), and that is not a pending server. */
  const optedIn = new Set(
    settings.filter((server) => server.user_enabled).map((server) => server.id),
  );

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

  for (const relation of relations ?? []) {
    const detail = relation.server;
    if (!relation.is_enabled || detail == null || servers.has(relation.mcp_server_id)) {
      continue;
    }
    if (optedIn.has(relation.mcp_server_id)) {
      continue;
    }
    if (detail.is_enabled === false || !PROXIED_SERVER_TYPES.has(detail.type)) {
      continue;
    }
    const gatewayName = gatewayNameFor(relation.mcp_server_id, detail.code);
    if (gatewayName == null) {
      continue;
    }
    /** An empty whitelist means the brain grants the whole server. */
    const whitelisted = relation.mcp_tool_ids?.length ?? 0;
    servers.set(relation.mcp_server_id, {
      id: relation.mcp_server_id,
      name: detail.name,
      code: detail.code ?? null,
      type: detail.type,
      gateway_name: gatewayName,
      user_enabled: false,
      tools: [],
      tool_count: whitelisted > 0 ? whitelisted : (detail.tool_count ?? undefined),
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
