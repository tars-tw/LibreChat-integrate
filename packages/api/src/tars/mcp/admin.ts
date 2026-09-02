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

/** Create/update payload for a pwc_tars MCP server (openapi / custom_api / external). */
export interface TarsMcpServerInput {
  name: string;
  code?: string;
  description?: string;
  type: 'openapi' | 'custom_api' | 'external';
  is_enabled?: boolean;
  priority?: number;
  tags?: string[];
  connection_config: Record<string, unknown>;
  tool_config?: Record<string, unknown>;
  env_vars?: Record<string, string>;
}

/** Per-tool update payload (`PUT /api/mcp/tools/<id>`). */
export interface TarsMcpToolInput {
  description?: string;
  is_enabled?: boolean;
  input_schema?: Record<string, unknown>;
}

/** One `sys_domain_mcp` relation row (+ joined server) from the domain-binding endpoints. */
export interface TarsDomainMcpRelation {
  id: string;
  sys_domain_id: number;
  mcp_server_id: string;
  is_enabled: boolean;
  mcp_tool_ids?: string[] | null;
  config?: Record<string, unknown> | null;
  server?: TarsMcpServerDetail | null;
  [key: string]: unknown;
}

/**
 * Full-overwrite domain↔MCP binding payload (`POST /api/mcp/domain/save`):
 * for every listed domain, unlisted servers get unbound and each listed
 * server's tool whitelist is replaced (`mcp_tool_ids: []` = whole server).
 */
export interface TarsDomainMcpSavePayload {
  domain_ids: number[];
  servers: Array<{ mcp_server_id: string; mcp_tool_ids?: string[] }>;
}

/** One `mcp_logs` audit row. */
export interface TarsMcpLogRow {
  id: string;
  sys_user_id: string;
  sys_domain_id?: number | null;
  conversation_id?: string | null;
  message_id?: string | null;
  mcp_server_id: string;
  tool_name: string;
  input_params?: Record<string, unknown> | null;
  output_result?: unknown;
  error_message?: string | null;
  status: string;
  duration_ms?: number | null;
  created_at?: string | null;
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

/** Result of `POST /api/mcp/servers/batch-delete` — some ids may be skipped or not found. */
export interface TarsMcpBatchDeleteResult {
  deleted: string[];
  skipped: string[];
  not_found: string[];
  deleted_count: number;
  skipped_count: number;
  failed_count: number;
}

export async function adminBatchDeleteTarsMcpServers(
  ids: string[],
): Promise<TarsMcpBatchDeleteResult | undefined> {
  return tarsMcpFetch<TarsMcpBatchDeleteResult>('/api/mcp/servers/batch-delete', {
    method: 'POST',
    body: { ids },
  });
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

/** Per-tool enable/disable or description/schema override. */
export async function adminUpdateTarsMcpTool(
  toolId: string,
  input: TarsMcpToolInput,
): Promise<TarsMcpToolDetail | undefined> {
  return tarsMcpFetch<TarsMcpToolDetail>(`/api/mcp/tools/${encodeURIComponent(toolId)}`, {
    method: 'PUT',
    body: input,
  });
}

export async function adminDeleteTarsMcpTool(toolId: string): Promise<void> {
  await tarsMcpFetch(`/api/mcp/tools/${encodeURIComponent(toolId)}`, { method: 'DELETE' });
}

/** The `sys_domain_mcp` bindings of one domain (existing whitelist state). */
export async function adminListTarsDomainMcpServers(
  domainId: number,
): Promise<TarsDomainMcpRelation[]> {
  const rows = await tarsMcpFetch<TarsDomainMcpRelation[]>(`/api/mcp/domain/${domainId}/servers`);
  return rows ?? [];
}

/** The servers (with tools) a domain's whitelist currently exposes. */
export async function adminListTarsDomainAvailableServers(
  domainId: number,
): Promise<TarsMcpServerDetail[]> {
  const rows = await tarsMcpFetch<TarsMcpServerDetail[]>(
    `/api/mcp/domain/${domainId}/available-servers`,
  );
  return rows ?? [];
}

/**
 * Overwrites the domain↔MCP bindings for the given domains. `tarsUserId` (the
 * acting admin) is forwarded so pwc_tars validates domain accessibility.
 */
export async function adminSaveTarsDomainMcp(
  payload: TarsDomainMcpSavePayload,
  tarsUserId: string,
): Promise<void> {
  await tarsMcpFetch('/api/mcp/domain/save', {
    method: 'POST',
    body: { ...payload, user_id: tarsUserId },
  });
}

/** Recent `mcp_logs` audit rows (newest first; optional conversation filter). */
export async function adminGetTarsMcpLogs(params: {
  conversation_id?: string;
  limit?: number;
}): Promise<TarsMcpLogRow[]> {
  const rows = await tarsMcpFetch<TarsMcpLogRow[]>('/api/mcp/logs', {
    query: {
      ...(params.conversation_id ? { conversation_id: params.conversation_id } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    },
  });
  return rows ?? [];
}
