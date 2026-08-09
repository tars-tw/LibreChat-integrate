import { Constants, tarsMcpServerName } from 'librechat-data-provider';
import type { TarsAvailableToolRow } from './client';
import {
  tarsMcpFetch,
  buildScopedToolName,
  PROXIED_SERVER_TYPES,
  invalidateTarsMcpToolsCache,
} from './client';

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
  tools: TarsMcpDomainTool[];
}

/**
 * The MCP tools one domain (腦袋) may use, double-filtered by pwc_tars
 * (`available-tools?user_id&domain_id`: domain whitelist incl. `mcp_tool_ids`,
 * plus the user's own `sys_user_mcp` toggles). Each tool carries the full
 * LibreChat tool key (`<scoped name>_mcp_<gateway name>`) — the same naming the
 * per-server gateway's `tools/list` produces — so the chat frontend can
 * whitelist tools on the ephemeral agent without further mapping.
 */
export async function getUserTarsDomainMcpTools(
  tarsUserId: string,
  domainId: number,
): Promise<TarsMcpDomainServer[]> {
  const rows = await tarsMcpFetch<TarsAvailableToolRow[]>('/api/mcp/available-tools', {
    query: { user_id: tarsUserId, domain_id: domainId },
  });

  const servers = new Map<string, TarsMcpDomainServer>();
  const takenByServer = new Map<string, Set<string>>();
  for (const row of rows ?? []) {
    if (!PROXIED_SERVER_TYPES.has(row.server_type)) {
      continue;
    }
    let server = servers.get(row.server_id);
    if (!server) {
      server = {
        id: row.server_id,
        name: row.server_name,
        code: row.server_code ?? null,
        type: row.server_type,
        gateway_name: tarsMcpServerName(row.server_code?.trim() || row.server_id.slice(0, 8)),
        tools: [],
      };
      servers.set(row.server_id, server);
      takenByServer.set(row.server_id, new Set());
    }
    const taken = takenByServer.get(row.server_id) as Set<string>;
    const scopedName = buildScopedToolName(row, taken);
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
  return [...servers.values()];
}

export async function getUserTarsMcpSettings(tarsUserId: string): Promise<TarsMcpUserServer[]> {
  const servers = await tarsMcpFetch<TarsMcpUserServer[]>('/api/mcp/user-settings', {
    query: { user_id: tarsUserId },
  });
  return servers ?? [];
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
