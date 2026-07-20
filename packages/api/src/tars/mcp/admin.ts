import { tarsMcpFetch } from './client';

/**
 * Admin-side proxy for managing pwc_tars MCP servers from LibreChat. pwc_tars
 * stays the source of truth — every call goes straight to its `/api/mcp` REST
 * API; nothing is persisted in LibreChat.
 */

/** `McpServer.to_dict()` plus route-injected fields (admin listing/detail). */
export interface TarsMcpServerDetail {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  type: 'openapi' | 'custom_api' | 'external' | 'builtin';
  is_enabled: boolean;
  priority?: number | null;
  tags?: string[] | null;
  connection_config?: Record<string, unknown> | null;
  tool_config?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  tool_count?: number;
  requires_user_credentials?: boolean;
  tools?: TarsMcpToolDetail[];
}

/** `McpTool.to_dict()` row. */
export interface TarsMcpToolDetail {
  id: string;
  mcp_server_id: string;
  name: string;
  description?: string | null;
  input_schema?: Record<string, unknown> | null;
  is_enabled: boolean;
}

/** Create/update payload for a pwc_tars MCP server (openapi / custom_api). */
export interface TarsMcpServerInput {
  name: string;
  code?: string;
  description?: string;
  type: 'openapi' | 'custom_api';
  is_enabled?: boolean;
  priority?: number;
  tags?: string[];
  connection_config: Record<string, unknown>;
  tool_config?: Record<string, unknown>;
  env_vars?: Record<string, string>;
}

export interface TarsMcpSyncResult {
  synced?: number;
  created?: number;
  updated?: number;
  deleted?: number;
  [key: string]: unknown;
}

export interface TarsMcpParsedSpec {
  api_info?: Record<string, unknown>;
  base_url?: string;
  tools?: Array<Record<string, unknown>>;
  tool_count?: number;
  login_hint?: Record<string, unknown> | null;
}

export async function adminListTarsMcpServers(): Promise<TarsMcpServerDetail[]> {
  const servers = await tarsMcpFetch<TarsMcpServerDetail[]>('/api/mcp/servers');
  return servers ?? [];
}

export async function adminGetTarsMcpServer(serverId: string): Promise<TarsMcpServerDetail | null> {
  const server = await tarsMcpFetch<TarsMcpServerDetail>(
    `/api/mcp/servers/${encodeURIComponent(serverId)}`,
  );
  return server ?? null;
}

export async function adminCreateTarsMcpServer(
  input: TarsMcpServerInput,
): Promise<TarsMcpServerDetail | undefined> {
  return tarsMcpFetch<TarsMcpServerDetail>('/api/mcp/servers', { method: 'POST', body: input });
}

export async function adminUpdateTarsMcpServer(
  serverId: string,
  input: Partial<TarsMcpServerInput>,
): Promise<TarsMcpServerDetail | undefined> {
  return tarsMcpFetch<TarsMcpServerDetail>(`/api/mcp/servers/${encodeURIComponent(serverId)}`, {
    method: 'PUT',
    body: input,
  });
}

export async function adminDeleteTarsMcpServer(serverId: string): Promise<void> {
  await tarsMcpFetch(`/api/mcp/servers/${encodeURIComponent(serverId)}`, { method: 'DELETE' });
}

/** Type-specific connectivity + auth probe (parses spec / validates config / probes auth). */
export async function adminTestTarsMcpServer(
  serverId: string,
): Promise<Record<string, unknown> | undefined> {
  return tarsMcpFetch<Record<string, unknown>>(
    `/api/mcp/servers/${encodeURIComponent(serverId)}/test`,
    { method: 'POST', body: {}, timeoutMs: 60_000 },
  );
}

/** Materializes the server's tool definitions into pwc_tars `mcp_tools` rows. */
export async function adminSyncTarsMcpServer(
  serverId: string,
): Promise<TarsMcpSyncResult | undefined> {
  return tarsMcpFetch<TarsMcpSyncResult>(`/api/mcp/servers/${encodeURIComponent(serverId)}/sync`, {
    method: 'POST',
    body: {},
    timeoutMs: 60_000,
  });
}

/** Parses an OpenAPI/Swagger spec (URL or file) and previews the generated tools. */
export async function adminParseTarsOpenapi(body: {
  openapi_url?: string;
  openapi_file?: string;
  base_url?: string;
  timeout?: number;
}): Promise<TarsMcpParsedSpec | undefined> {
  return tarsMcpFetch<TarsMcpParsedSpec>('/api/mcp/parse-openapi', {
    method: 'POST',
    body,
    timeoutMs: 60_000,
  });
}
