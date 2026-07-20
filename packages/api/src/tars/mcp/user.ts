import { tarsMcpFetch, invalidateTarsMcpToolsCache } from './client';

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
